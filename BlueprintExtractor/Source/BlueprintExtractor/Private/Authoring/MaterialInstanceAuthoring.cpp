#include "Authoring/MaterialInstanceAuthoring.h"

#include "Authoring/AssetMutationHelpers.h"

#include "AssetRegistry/AssetRegistryModule.h"
#include "CoreGlobals.h"
#include "Engine/Texture.h"
#include "Factories/MaterialInstanceConstantFactoryNew.h"
#include "MaterialEditingLibrary.h"
#include "Materials/Material.h"
#include "Materials/MaterialInstance.h"
#include "Materials/MaterialInstanceConstant.h"
#include "Materials/MaterialInterface.h"
#include "Misc/PackageName.h"
#include "UObject/Package.h"
#include "UObject/UObjectGlobals.h"

namespace MaterialInstanceAuthoringInternal
{

static bool ParseColor(const TSharedPtr<FJsonObject>& ColorObject, FLinearColor& OutColor)
{
	if (!ColorObject.IsValid())
	{
		return false;
	}

	double R = 0.0;
	double G = 0.0;
	double B = 0.0;
	double A = 1.0;
	return ColorObject->TryGetNumberField(TEXT("r"), R)
		&& ColorObject->TryGetNumberField(TEXT("g"), G)
		&& ColorObject->TryGetNumberField(TEXT("b"), B)
		&& ColorObject->TryGetNumberField(TEXT("a"), A)
		&& ((OutColor = FLinearColor(static_cast<float>(R), static_cast<float>(G), static_cast<float>(B), static_cast<float>(A))), true);
}

static UMaterialInterface* ResolveParentMaterial(const FString& ParentMaterialPath)
{
	if (ParentMaterialPath.IsEmpty())
	{
		return nullptr;
	}

	return LoadObject<UMaterialInterface>(nullptr, *ParentMaterialPath);
}

static bool ValidatePayload(UMaterialInstanceConstant* MaterialInstance,
                            const TSharedPtr<FJsonObject>& PayloadJson,
                            FAssetMutationContext& Context)
{
	if (!PayloadJson.IsValid())
	{
		Context.SetValidationSummary(true, TEXT("Empty material payload validated."));
		return true;
	}

	bool bSuccess = true;
	TArray<FString> ValidationErrors;

	FString ParentMaterialPath;
	if (PayloadJson->TryGetStringField(TEXT("parentMaterial"), ParentMaterialPath) && !ParentMaterialPath.IsEmpty())
	{
		if (!ResolveParentMaterial(ParentMaterialPath))
		{
			ValidationErrors.Add(FString::Printf(TEXT("Failed to load parent material '%s'"), *ParentMaterialPath));
			bSuccess = false;
		}
	}

	auto ValidateNamedArray = [&](const TCHAR* FieldName, TFunctionRef<bool(const TSharedPtr<FJsonObject>&)> Validator)
	{
		const TArray<TSharedPtr<FJsonValue>>* Items = nullptr;
		if (!PayloadJson->TryGetArrayField(FieldName, Items) || !Items)
		{
			return;
		}

		for (const TSharedPtr<FJsonValue>& ItemValue : *Items)
		{
			const TSharedPtr<FJsonObject> Item = ItemValue.IsValid() ? ItemValue->AsObject() : nullptr;
			if (!Item.IsValid() || !Validator(Item))
			{
				ValidationErrors.Add(FString::Printf(TEXT("Invalid payload entry in '%s'"), FieldName));
				bSuccess = false;
			}
		}
	};

	ValidateNamedArray(TEXT("scalarParameters"), [&](const TSharedPtr<FJsonObject>& Item)
	{
		FString Name;
		double Value = 0.0;
		return Item->TryGetStringField(TEXT("name"), Name) && Item->TryGetNumberField(TEXT("value"), Value);
	});

	ValidateNamedArray(TEXT("vectorParameters"), [&](const TSharedPtr<FJsonObject>& Item)
	{
		FString Name;
		FLinearColor Color;
		const TSharedPtr<FJsonObject>* ColorObject = nullptr;
		return Item->TryGetStringField(TEXT("name"), Name)
			&& Item->TryGetObjectField(TEXT("value"), ColorObject)
			&& ColorObject
			&& ParseColor(*ColorObject, Color);
	});

	ValidateNamedArray(TEXT("textureParameters"), [&](const TSharedPtr<FJsonObject>& Item)
	{
		FString Name;
		if (!Item->TryGetStringField(TEXT("name"), Name))
		{
			return false;
		}

		if (!Item->HasField(TEXT("value")) || Item->Values[TEXT("value")]->Type == EJson::Null)
		{
			return true;
		}

		FString TexturePath;
		return Item->TryGetStringField(TEXT("value"), TexturePath)
			&& (TexturePath.IsEmpty() || LoadObject<UTexture>(nullptr, *TexturePath) != nullptr);
	});

	ValidateNamedArray(TEXT("staticSwitchParameters"), [&](const TSharedPtr<FJsonObject>& Item)
	{
		FString Name;
		bool bValue = false;
		return Item->TryGetStringField(TEXT("name"), Name) && Item->TryGetBoolField(TEXT("value"), bValue);
	});

	Context.SetValidationSummary(
		bSuccess,
		bSuccess ? TEXT("MaterialInstance payload validated.") : TEXT("MaterialInstance payload failed validation."),
		ValidationErrors);

	for (const FString& Error : ValidationErrors)
	{
		Context.AddError(TEXT("validation_error"), Error, MaterialInstance ? MaterialInstance->GetPathName() : FString());
	}

	return bSuccess;
}

} // namespace MaterialInstanceAuthoringInternal

TSharedPtr<FJsonObject> FMaterialInstanceAuthoring::Create(const FString& AssetPath,
                                                           const FString& ParentMaterialPath,
                                                           const bool bValidateOnly)
{
	using namespace MaterialInstanceAuthoringInternal;

	FAssetMutationContext Context(TEXT("create_material_instance"), AssetPath, TEXT("MaterialInstance"), bValidateOnly);

	UMaterialInterface* ParentMaterial = ResolveParentMaterial(ParentMaterialPath);
	if (!ParentMaterial)
	{
		Context.AddError(TEXT("parent_material_not_found"),
		                 FString::Printf(TEXT("Parent material not found: %s"), *ParentMaterialPath),
		                 ParentMaterialPath);
		return Context.BuildResult(false);
	}

	Context.SetValidationSummary(true, TEXT("MaterialInstance creation inputs validated."));

	if (bValidateOnly)
	{
		return Context.BuildResult(true);
	}

	Context.BeginTransaction(FText::FromString(TEXT("Create Material Instance")));

	UPackage* Package = CreatePackage(*AssetPath);
	if (!Package)
	{
		Context.AddError(TEXT("package_create_failed"),
		                 FString::Printf(TEXT("Failed to create package: %s"), *AssetPath),
		                 AssetPath);
		return Context.BuildResult(false);
	}

	UMaterialInstanceConstantFactoryNew* Factory = NewObject<UMaterialInstanceConstantFactoryNew>();
	if (!Factory)
	{
		Context.AddError(TEXT("factory_create_failed"), TEXT("Failed to create MaterialInstanceConstant factory."));
		return Context.BuildResult(false);
	}

	const FName AssetName = FPackageName::GetShortFName(AssetPath);
	UObject* CreatedObject = Factory->FactoryCreateNew(
		UMaterialInstanceConstant::StaticClass(),
		Package,
		AssetName,
		RF_Public | RF_Standalone,
		nullptr,
		GWarn);

	UMaterialInstanceConstant* MaterialInstance = Cast<UMaterialInstanceConstant>(CreatedObject);
	if (!MaterialInstance)
	{
		Context.AddError(TEXT("asset_create_failed"),
		                 FString::Printf(TEXT("Failed to create MaterialInstance asset: %s"), *AssetPath),
		                 AssetPath);
		return Context.BuildResult(false);
	}

	MaterialInstance->Modify();
	MaterialInstance->SetParentEditorOnly(ParentMaterial, true);
	MaterialInstance->PostEditChange();

	FAssetRegistryModule::AssetCreated(MaterialInstance);
	Package->MarkPackageDirty();
	Context.TrackDirtyObject(MaterialInstance);

	TSharedPtr<FJsonObject> Result = Context.BuildResult(true);
	Result->SetStringField(TEXT("parentMaterial"), ParentMaterial->GetPathName());
	return Result;
}

TSharedPtr<FJsonObject> FMaterialInstanceAuthoring::Modify(UMaterialInstance* MaterialInstance,
                                                           const TSharedPtr<FJsonObject>& PayloadJson,
                                                           const bool bValidateOnly)
{
	UMaterialInstanceConstant* ConstantInstance = Cast<UMaterialInstanceConstant>(MaterialInstance);
	const FString AssetPath = MaterialInstance ? MaterialInstance->GetPathName() : FString();
	FAssetMutationContext Context(TEXT("modify_material_instance"), AssetPath, TEXT("MaterialInstance"), bValidateOnly);

	if (!ConstantInstance)
	{
		Context.AddError(TEXT("invalid_material_instance"),
		                 TEXT("MaterialInstance must be a UMaterialInstanceConstant for authoring operations."),
		                 AssetPath);
		return Context.BuildResult(false);
	}

	if (!MaterialInstanceAuthoringInternal::ValidatePayload(ConstantInstance, PayloadJson, Context))
	{
		return Context.BuildResult(false);
	}

	if (bValidateOnly)
	{
		return Context.BuildResult(true);
	}

	Context.BeginTransaction(FText::FromString(TEXT("Modify Material Instance")));
	ConstantInstance->Modify();

	FString ParentMaterialPath;
	if (PayloadJson.IsValid() && PayloadJson->TryGetStringField(TEXT("parentMaterial"), ParentMaterialPath) && !ParentMaterialPath.IsEmpty())
	{
		if (UMaterialInterface* ParentMaterial = MaterialInstanceAuthoringInternal::ResolveParentMaterial(ParentMaterialPath))
		{
			ConstantInstance->SetParentEditorOnly(ParentMaterial, true);
		}
	}

	auto ApplyNamedArray = [&](const TCHAR* FieldName, TFunctionRef<bool(const TSharedPtr<FJsonObject>&)> ApplyFn)
	{
		const TArray<TSharedPtr<FJsonValue>>* Items = nullptr;
		if (!PayloadJson.IsValid() || !PayloadJson->TryGetArrayField(FieldName, Items) || !Items)
		{
			return;
		}

		for (const TSharedPtr<FJsonValue>& ItemValue : *Items)
		{
			const TSharedPtr<FJsonObject> Item = ItemValue.IsValid() ? ItemValue->AsObject() : nullptr;
			if (!Item.IsValid() || !ApplyFn(Item))
			{
				Context.AddError(TEXT("apply_error"),
				                 FString::Printf(TEXT("Failed to apply '%s' payload entry."), FieldName),
				                 AssetPath);
			}
		}
	};

	ApplyNamedArray(TEXT("scalarParameters"), [&](const TSharedPtr<FJsonObject>& Item)
	{
		FString Name;
		double Value = 0.0;
		return Item->TryGetStringField(TEXT("name"), Name)
			&& Item->TryGetNumberField(TEXT("value"), Value)
			&& UMaterialEditingLibrary::SetMaterialInstanceScalarParameterValue(ConstantInstance, FName(*Name), static_cast<float>(Value));
	});

	ApplyNamedArray(TEXT("vectorParameters"), [&](const TSharedPtr<FJsonObject>& Item)
	{
		FString Name;
		FLinearColor Color;
		const TSharedPtr<FJsonObject>* ColorObject = nullptr;
		return Item->TryGetStringField(TEXT("name"), Name)
			&& Item->TryGetObjectField(TEXT("value"), ColorObject)
			&& ColorObject
			&& MaterialInstanceAuthoringInternal::ParseColor(*ColorObject, Color)
			&& UMaterialEditingLibrary::SetMaterialInstanceVectorParameterValue(ConstantInstance, FName(*Name), Color);
	});

	ApplyNamedArray(TEXT("textureParameters"), [&](const TSharedPtr<FJsonObject>& Item)
	{
		FString Name;
		if (!Item->TryGetStringField(TEXT("name"), Name))
		{
			return false;
		}

		if (!Item->HasField(TEXT("value")) || Item->Values[TEXT("value")]->Type == EJson::Null)
		{
			return UMaterialEditingLibrary::SetMaterialInstanceTextureParameterValue(ConstantInstance, FName(*Name), nullptr);
		}

		FString TexturePath;
		UTexture* Texture = Item->TryGetStringField(TEXT("value"), TexturePath)
			? LoadObject<UTexture>(nullptr, *TexturePath)
			: nullptr;
		return Texture && UMaterialEditingLibrary::SetMaterialInstanceTextureParameterValue(ConstantInstance, FName(*Name), Texture);
	});

	ApplyNamedArray(TEXT("staticSwitchParameters"), [&](const TSharedPtr<FJsonObject>& Item)
	{
		FString Name;
		bool bValue = false;
		return Item->TryGetStringField(TEXT("name"), Name)
			&& Item->TryGetBoolField(TEXT("value"), bValue)
			&& UMaterialEditingLibrary::SetMaterialInstanceStaticSwitchParameterValue(
				ConstantInstance,
				FName(*Name),
				bValue,
				EMaterialParameterAssociation::GlobalParameter);
	});

	UMaterialEditingLibrary::UpdateMaterialInstance(ConstantInstance);
	ConstantInstance->PostEditChange();
	ConstantInstance->MarkPackageDirty();
	Context.TrackDirtyObject(ConstantInstance);
	return Context.BuildResult(Context.Diagnostics.FilterByPredicate([](const FAssetMutationDiagnostic& Diagnostic)
	{
		return Diagnostic.Severity == TEXT("error");
	}).Num() == 0);
}
