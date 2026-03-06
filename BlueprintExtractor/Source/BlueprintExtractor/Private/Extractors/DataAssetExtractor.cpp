#include "Extractors/DataAssetExtractor.h"
#include "BlueprintExtractorModule.h"
#include "Engine/DataAsset.h"

TSharedPtr<FJsonObject> FDataAssetExtractor::Extract(const UDataAsset* DataAsset)
{
	if (!ensureMsgf(DataAsset, TEXT("DataAssetExtractor: null DataAsset")))
	{
		return nullptr;
	}

	TSharedPtr<FJsonObject> Root = MakeShared<FJsonObject>();
	Root->SetStringField(TEXT("schemaVersion"), TEXT("1.0.0"));

	TSharedPtr<FJsonObject> DAObj = MakeShared<FJsonObject>();
	DAObj->SetStringField(TEXT("assetPath"), DataAsset->GetPathName());
	DAObj->SetStringField(TEXT("assetName"), DataAsset->GetName());
	DAObj->SetStringField(TEXT("dataAssetClass"), DataAsset->GetClass()->GetName());

	// Determine which base classes to skip (only extract user-defined properties)
	static const UClass* DataAssetBase         = UDataAsset::StaticClass();
	static const UClass* PrimaryDataAssetBase  = FindObject<UClass>(nullptr, TEXT("/Script/Engine.PrimaryDataAsset"));
	static const UClass* ObjectBase            = UObject::StaticClass();

	TArray<TSharedPtr<FJsonValue>> Properties;

	for (TFieldIterator<FProperty> PropIt(DataAsset->GetClass()); PropIt; ++PropIt)
	{
		FProperty* Property = *PropIt;

		// Skip properties owned by UDataAsset, UPrimaryDataAsset, or UObject
		const UClass* OwnerClass = Property->GetOwnerClass();
		if (OwnerClass == DataAssetBase || OwnerClass == ObjectBase ||
			(PrimaryDataAssetBase && OwnerClass == PrimaryDataAssetBase))
		{
			continue;
		}

		// Skip deprecated and transient properties
		if (Property->HasAnyPropertyFlags(CPF_Deprecated | CPF_Transient))
		{
			continue;
		}

		TSharedPtr<FJsonObject> PropObj = MakeShared<FJsonObject>();
		PropObj->SetStringField(TEXT("name"), Property->GetName());
		PropObj->SetStringField(TEXT("cppType"), Property->GetCPPType());

		// Export value
		FString ValueStr;
		const uint8* ContainerPtr = reinterpret_cast<const uint8*>(DataAsset);
		Property->ExportText_InContainer(0, ValueStr, ContainerPtr, nullptr, nullptr, PPF_None);
		PropObj->SetStringField(TEXT("value"), ValueStr);

		// For object references, also include the path
		if (const FObjectPropertyBase* ObjProp = CastField<FObjectPropertyBase>(Property))
		{
			UObject* ReferencedObj = ObjProp->GetObjectPropertyValue_InContainer(ContainerPtr);
			if (ReferencedObj)
			{
				PropObj->SetStringField(TEXT("referencePath"), ReferencedObj->GetPathName());
			}
		}

		Properties.Add(MakeShared<FJsonValueObject>(PropObj));
	}

	DAObj->SetArrayField(TEXT("properties"), Properties);

	Root->SetObjectField(TEXT("dataAsset"), DAObj);
	return Root;
}
