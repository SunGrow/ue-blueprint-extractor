#include "Extractors/MaterialInstanceExtractor.h"

#include "BlueprintExtractorVersion.h"
#include "Engine/Font.h"
#include "Engine/Texture.h"
#if __has_include("Materials/MaterialParameters.h")
#include "Materials/MaterialParameters.h"
#else
#include "MaterialTypes.h"
#endif
#include "Materials/Material.h"
#include "Materials/MaterialInstance.h"
#include "Materials/MaterialInterface.h"
#include "VT/RuntimeVirtualTexture.h"

namespace MaterialInstanceExtractorInternal
{

static FString AssociationToString(const EMaterialParameterAssociation Association)
{
	switch (Association)
	{
	case EMaterialParameterAssociation::LayerParameter:
		return TEXT("LayerParameter");
	case EMaterialParameterAssociation::BlendParameter:
		return TEXT("BlendParameter");
	default:
		return TEXT("GlobalParameter");
	}
}

static TSharedPtr<FJsonObject> MakeParameterObject(const UMaterialInterface* MaterialInterface, const FMaterialParameterInfo& ParameterInfo)
{
	TSharedPtr<FJsonObject> ParameterObject = MakeShared<FJsonObject>();
	ParameterObject->SetStringField(TEXT("name"), ParameterInfo.Name.ToString());
	ParameterObject->SetStringField(TEXT("association"), AssociationToString(ParameterInfo.Association));
	if (ParameterInfo.Index != INDEX_NONE)
	{
		ParameterObject->SetNumberField(TEXT("index"), ParameterInfo.Index);
	}

#if WITH_EDITOR
	FName GroupName;
	if (MaterialInterface->GetGroupName(FHashedMaterialParameterInfo(ParameterInfo), GroupName) && !GroupName.IsNone())
	{
		ParameterObject->SetStringField(TEXT("group"), GroupName.ToString());
	}
#endif

	return ParameterObject;
}

static TSharedPtr<FJsonObject> SerializeLinearColor(const FLinearColor& Color)
{
	TSharedPtr<FJsonObject> ColorObject = MakeShared<FJsonObject>();
	ColorObject->SetNumberField(TEXT("r"), Color.R);
	ColorObject->SetNumberField(TEXT("g"), Color.G);
	ColorObject->SetNumberField(TEXT("b"), Color.B);
	ColorObject->SetNumberField(TEXT("a"), Color.A);
	return ColorObject;
}

} // namespace MaterialInstanceExtractorInternal

TSharedPtr<FJsonObject> FMaterialInstanceExtractor::Extract(const UMaterialInstance* MaterialInstance)
{
	if (!MaterialInstance)
	{
		return nullptr;
	}

	TSharedPtr<FJsonObject> Root = MakeShared<FJsonObject>();
	Root->SetStringField(TEXT("schemaVersion"), BlueprintExtractor::SchemaVersion);

	TSharedPtr<FJsonObject> MaterialObject = MakeShared<FJsonObject>();
	MaterialObject->SetStringField(TEXT("assetPath"), MaterialInstance->GetPathName());
	MaterialObject->SetStringField(TEXT("assetName"), MaterialInstance->GetName());

	if (MaterialInstance->Parent)
	{
		MaterialObject->SetStringField(TEXT("parentMaterial"), MaterialInstance->Parent->GetPathName());
	}

	if (const UMaterial* BaseMaterial = MaterialInstance->GetMaterial())
	{
		MaterialObject->SetStringField(TEXT("baseMaterial"), BaseMaterial->GetPathName());
	}

	{
		TArray<FMaterialParameterInfo> ParameterInfos;
		TArray<FGuid> ParameterIds;
		MaterialInstance->GetAllScalarParameterInfo(ParameterInfos, ParameterIds);

		TArray<TSharedPtr<FJsonValue>> Parameters;
		for (const FMaterialParameterInfo& ParameterInfo : ParameterInfos)
		{
			float Value = 0.0f;
			if (!MaterialInstance->GetScalarParameterValue(FHashedMaterialParameterInfo(ParameterInfo), Value))
			{
				continue;
			}

			TSharedPtr<FJsonObject> ParameterObject = MaterialInstanceExtractorInternal::MakeParameterObject(MaterialInstance, ParameterInfo);
			ParameterObject->SetNumberField(TEXT("value"), Value);

			float OverrideValue = 0.0f;
			ParameterObject->SetBoolField(TEXT("isOverridden"), MaterialInstance->GetScalarParameterValue(FHashedMaterialParameterInfo(ParameterInfo), OverrideValue, true));
			Parameters.Add(MakeShared<FJsonValueObject>(ParameterObject));
		}
		MaterialObject->SetArrayField(TEXT("scalarParameters"), Parameters);
	}

	{
		TArray<FMaterialParameterInfo> ParameterInfos;
		TArray<FGuid> ParameterIds;
		MaterialInstance->GetAllVectorParameterInfo(ParameterInfos, ParameterIds);

		TArray<TSharedPtr<FJsonValue>> Parameters;
		for (const FMaterialParameterInfo& ParameterInfo : ParameterInfos)
		{
			FLinearColor Value = FLinearColor::Black;
			if (!MaterialInstance->GetVectorParameterValue(FHashedMaterialParameterInfo(ParameterInfo), Value))
			{
				continue;
			}

			TSharedPtr<FJsonObject> ParameterObject = MaterialInstanceExtractorInternal::MakeParameterObject(MaterialInstance, ParameterInfo);
			ParameterObject->SetObjectField(TEXT("value"), MaterialInstanceExtractorInternal::SerializeLinearColor(Value));

			FLinearColor OverrideValue = FLinearColor::Black;
			ParameterObject->SetBoolField(TEXT("isOverridden"), MaterialInstance->GetVectorParameterValue(FHashedMaterialParameterInfo(ParameterInfo), OverrideValue, true));
			Parameters.Add(MakeShared<FJsonValueObject>(ParameterObject));
		}
		MaterialObject->SetArrayField(TEXT("vectorParameters"), Parameters);
	}

	{
		TArray<FMaterialParameterInfo> ParameterInfos;
		TArray<FGuid> ParameterIds;
		MaterialInstance->GetAllTextureParameterInfo(ParameterInfos, ParameterIds);

		TArray<TSharedPtr<FJsonValue>> Parameters;
		for (const FMaterialParameterInfo& ParameterInfo : ParameterInfos)
		{
			UTexture* Value = nullptr;
			if (!MaterialInstance->GetTextureParameterValue(FHashedMaterialParameterInfo(ParameterInfo), Value))
			{
				continue;
			}

			TSharedPtr<FJsonObject> ParameterObject = MaterialInstanceExtractorInternal::MakeParameterObject(MaterialInstance, ParameterInfo);
			if (Value)
			{
				ParameterObject->SetStringField(TEXT("value"), Value->GetPathName());
			}
			else
			{
				ParameterObject->SetField(TEXT("value"), MakeShared<FJsonValueNull>());
			}

			UTexture* OverrideValue = nullptr;
			ParameterObject->SetBoolField(TEXT("isOverridden"), MaterialInstance->GetTextureParameterValue(FHashedMaterialParameterInfo(ParameterInfo), OverrideValue, true));
			Parameters.Add(MakeShared<FJsonValueObject>(ParameterObject));
		}
		MaterialObject->SetArrayField(TEXT("textureParameters"), Parameters);
	}

	{
		TArray<FMaterialParameterInfo> ParameterInfos;
		TArray<FGuid> ParameterIds;
		MaterialInstance->GetAllRuntimeVirtualTextureParameterInfo(ParameterInfos, ParameterIds);

		TArray<TSharedPtr<FJsonValue>> Parameters;
		for (const FMaterialParameterInfo& ParameterInfo : ParameterInfos)
		{
			URuntimeVirtualTexture* Value = nullptr;
			if (!MaterialInstance->GetRuntimeVirtualTextureParameterValue(FHashedMaterialParameterInfo(ParameterInfo), Value))
			{
				continue;
			}

			TSharedPtr<FJsonObject> ParameterObject = MaterialInstanceExtractorInternal::MakeParameterObject(MaterialInstance, ParameterInfo);
			if (Value)
			{
				ParameterObject->SetStringField(TEXT("value"), Value->GetPathName());
			}
			else
			{
				ParameterObject->SetField(TEXT("value"), MakeShared<FJsonValueNull>());
			}
			Parameters.Add(MakeShared<FJsonValueObject>(ParameterObject));
		}
		MaterialObject->SetArrayField(TEXT("runtimeVirtualTextureParameters"), Parameters);
	}

	{
		TArray<FMaterialParameterInfo> ParameterInfos;
		TArray<FGuid> ParameterIds;
		MaterialInstance->GetAllFontParameterInfo(ParameterInfos, ParameterIds);

		TArray<TSharedPtr<FJsonValue>> Parameters;
		for (const FMaterialParameterInfo& ParameterInfo : ParameterInfos)
		{
			UFont* FontValue = nullptr;
			int32 FontPage = 0;
			if (!MaterialInstance->GetFontParameterValue(FHashedMaterialParameterInfo(ParameterInfo), FontValue, FontPage))
			{
				continue;
			}

			TSharedPtr<FJsonObject> ParameterObject = MaterialInstanceExtractorInternal::MakeParameterObject(MaterialInstance, ParameterInfo);
			if (FontValue)
			{
				ParameterObject->SetStringField(TEXT("value"), FontValue->GetPathName());
			}
			else
			{
				ParameterObject->SetField(TEXT("value"), MakeShared<FJsonValueNull>());
			}
			ParameterObject->SetNumberField(TEXT("fontPage"), FontPage);
			Parameters.Add(MakeShared<FJsonValueObject>(ParameterObject));
		}
		MaterialObject->SetArrayField(TEXT("fontParameters"), Parameters);
	}

#if WITH_EDITORONLY_DATA
	{
		TArray<FMaterialParameterInfo> ParameterInfos;
		TArray<FGuid> ParameterIds;
		MaterialInstance->GetAllStaticSwitchParameterInfo(ParameterInfos, ParameterIds);

		TArray<TSharedPtr<FJsonValue>> Parameters;
		for (const FMaterialParameterInfo& ParameterInfo : ParameterInfos)
		{
			bool Value = false;
			FGuid ExpressionGuid;
			if (!MaterialInstance->GetStaticSwitchParameterValue(FHashedMaterialParameterInfo(ParameterInfo), Value, ExpressionGuid))
			{
				continue;
			}

			TSharedPtr<FJsonObject> ParameterObject = MaterialInstanceExtractorInternal::MakeParameterObject(MaterialInstance, ParameterInfo);
			ParameterObject->SetBoolField(TEXT("value"), Value);

			bool OverrideValue = false;
			FGuid OverrideGuid;
			ParameterObject->SetBoolField(TEXT("isOverridden"), MaterialInstance->GetStaticSwitchParameterValue(FHashedMaterialParameterInfo(ParameterInfo), OverrideValue, OverrideGuid, true));
			if (ExpressionGuid.IsValid())
			{
				ParameterObject->SetStringField(TEXT("expressionGuid"), ExpressionGuid.ToString());
			}
			Parameters.Add(MakeShared<FJsonValueObject>(ParameterObject));
		}
		MaterialObject->SetArrayField(TEXT("staticSwitchParameters"), Parameters);
	}
#else
	MaterialObject->SetArrayField(TEXT("staticSwitchParameters"), TArray<TSharedPtr<FJsonValue>>());
#endif

	Root->SetObjectField(TEXT("materialInstance"), MaterialObject);
	return Root;
}
