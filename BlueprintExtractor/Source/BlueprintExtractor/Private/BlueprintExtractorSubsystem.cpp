#include "BlueprintExtractorSubsystem.h"
#include "BlueprintExtractorLibrary.h"
#include "BlueprintExtractorSettings.h"
#include "Animation/AnimMontage.h"
#include "Animation/AnimSequence.h"
#include "Animation/AnimBlueprint.h"
#include "Animation/BlendSpace.h"
#include "BehaviorTree/BehaviorTree.h"
#include "BehaviorTree/BlackboardData.h"
#include "Curves/CurveBase.h"
#include "Engine/Blueprint.h"
#include "Engine/CurveTable.h"
#include "Engine/DataAsset.h"
#include "Engine/DataTable.h"
#include "Engine/UserDefinedEnum.h"
#include "Materials/MaterialInstance.h"
#include "StateTree.h"
#include "StructUtils/UserDefinedStruct.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "AssetRegistry/IAssetRegistry.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Serialization/JsonReader.h"
#include "Builders/WidgetTreeBuilder.h"
#include "WidgetBlueprint.h"

static FString MakeErrorJson(const FString& Message)
{
	const TSharedPtr<FJsonObject> ErrorObj = MakeShared<FJsonObject>();
	ErrorObj->SetStringField(TEXT("error"), Message);

	FString OutString;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutString);
	FJsonSerializer::Serialize(ErrorObj.ToSharedRef(), Writer);
	return OutString;
}

static FString SerializeJsonObject(const TSharedPtr<FJsonObject>& JsonObject)
{
	FString OutString;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutString);
	FJsonSerializer::Serialize(JsonObject.ToSharedRef(), Writer);
	return OutString;
}

static bool ResolveAssetClassFilter(const FString& ClassFilter, FTopLevelAssetPath& OutClassPath, bool& bOutRecursiveClasses)
{
	bOutRecursiveClasses = false;

	if (ClassFilter.IsEmpty())
	{
		return false;
	}

	if (ClassFilter.Equals(TEXT("Blueprint"), ESearchCase::IgnoreCase))
	{
		OutClassPath = UBlueprint::StaticClass()->GetClassPathName();
		return true;
	}

	if (ClassFilter.Equals(TEXT("AnimBlueprint"), ESearchCase::IgnoreCase))
	{
		OutClassPath = UAnimBlueprint::StaticClass()->GetClassPathName();
		return true;
	}

	if (ClassFilter.Equals(TEXT("WidgetBlueprint"), ESearchCase::IgnoreCase))
	{
		OutClassPath = UWidgetBlueprint::StaticClass()->GetClassPathName();
		return true;
	}

	if (ClassFilter.Equals(TEXT("StateTree"), ESearchCase::IgnoreCase))
	{
		OutClassPath = UStateTree::StaticClass()->GetClassPathName();
		return true;
	}

	if (ClassFilter.Equals(TEXT("BehaviorTree"), ESearchCase::IgnoreCase))
	{
		OutClassPath = UBehaviorTree::StaticClass()->GetClassPathName();
		return true;
	}

	if (ClassFilter.Equals(TEXT("Blackboard"), ESearchCase::IgnoreCase)
		|| ClassFilter.Equals(TEXT("BlackboardData"), ESearchCase::IgnoreCase))
	{
		OutClassPath = UBlackboardData::StaticClass()->GetClassPathName();
		return true;
	}

	if (ClassFilter.Equals(TEXT("DataTable"), ESearchCase::IgnoreCase))
	{
		OutClassPath = UDataTable::StaticClass()->GetClassPathName();
		return true;
	}

	if (ClassFilter.Equals(TEXT("DataAsset"), ESearchCase::IgnoreCase))
	{
		OutClassPath = UDataAsset::StaticClass()->GetClassPathName();
		bOutRecursiveClasses = true;
		return true;
	}

	if (ClassFilter.Equals(TEXT("UserDefinedStruct"), ESearchCase::IgnoreCase))
	{
		OutClassPath = UUserDefinedStruct::StaticClass()->GetClassPathName();
		return true;
	}

	if (ClassFilter.Equals(TEXT("UserDefinedEnum"), ESearchCase::IgnoreCase))
	{
		OutClassPath = UUserDefinedEnum::StaticClass()->GetClassPathName();
		return true;
	}

	if (ClassFilter.Equals(TEXT("Curve"), ESearchCase::IgnoreCase))
	{
		OutClassPath = UCurveBase::StaticClass()->GetClassPathName();
		bOutRecursiveClasses = true;
		return true;
	}

	if (ClassFilter.Equals(TEXT("CurveTable"), ESearchCase::IgnoreCase))
	{
		OutClassPath = UCurveTable::StaticClass()->GetClassPathName();
		return true;
	}

	if (ClassFilter.Equals(TEXT("MaterialInstance"), ESearchCase::IgnoreCase))
	{
		OutClassPath = UMaterialInstance::StaticClass()->GetClassPathName();
		bOutRecursiveClasses = true;
		return true;
	}

	if (ClassFilter.Equals(TEXT("AnimSequence"), ESearchCase::IgnoreCase))
	{
		OutClassPath = UAnimSequence::StaticClass()->GetClassPathName();
		return true;
	}

	if (ClassFilter.Equals(TEXT("AnimMontage"), ESearchCase::IgnoreCase))
	{
		OutClassPath = UAnimMontage::StaticClass()->GetClassPathName();
		return true;
	}

	if (ClassFilter.Equals(TEXT("BlendSpace"), ESearchCase::IgnoreCase))
	{
		OutClassPath = UBlendSpace::StaticClass()->GetClassPathName();
		bOutRecursiveClasses = true;
		return true;
	}

	return false;
}

EBlueprintExtractionScope UBlueprintExtractorSubsystem::ParseScope(const FString& ScopeString)
{
	if (ScopeString == TEXT("ClassLevel"))       { return EBlueprintExtractionScope::ClassLevel; }
	if (ScopeString == TEXT("Variables"))        { return EBlueprintExtractionScope::Variables; }
	if (ScopeString == TEXT("Components"))       { return EBlueprintExtractionScope::Components; }
	if (ScopeString == TEXT("FunctionsShallow")) { return EBlueprintExtractionScope::FunctionsShallow; }
	if (ScopeString == TEXT("FullWithBytecode")) { return EBlueprintExtractionScope::FullWithBytecode; }
	return EBlueprintExtractionScope::Full;
}

FString UBlueprintExtractorSubsystem::ExtractBlueprint(const FString& AssetPath, const FString& Scope, const FString& GraphFilter)
{
	const EBlueprintExtractionScope ParsedScope = ParseScope(Scope);

	UBlueprint* Blueprint = LoadObject<UBlueprint>(nullptr, *AssetPath);
	if (Blueprint == nullptr)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found: %s"), *AssetPath));
	}

	// Parse comma-separated graph filter into TArray<FName>
	TArray<FName> ParsedFilter;
	if (!GraphFilter.IsEmpty())
	{
		TArray<FString> Parts;
		GraphFilter.ParseIntoArray(Parts, TEXT(","), true);
		for (const FString& Part : Parts)
		{
			ParsedFilter.Add(FName(*Part.TrimStartAndEnd()));
		}
	}

	FString OutString;
	UBlueprintExtractorLibrary::ExtractBlueprintToJsonString(Blueprint, OutString, ParsedScope, ParsedFilter);
	return OutString;
}

FString UBlueprintExtractorSubsystem::ExtractStateTree(const FString& AssetPath)
{
	UStateTree* StateTree = LoadObject<UStateTree>(nullptr, *AssetPath);
	if (StateTree == nullptr)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found: %s"), *AssetPath));
	}

	const TSharedPtr<FJsonObject> JsonObject = UBlueprintExtractorLibrary::ExtractStateTreeToJsonObject(StateTree);
	if (!JsonObject.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to extract StateTree"));
	}

	FString OutString;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutString);
	FJsonSerializer::Serialize(JsonObject.ToSharedRef(), Writer);
	return OutString;
}

FString UBlueprintExtractorSubsystem::ExtractDataAsset(const FString& AssetPath)
{
	UDataAsset* DataAsset = LoadObject<UDataAsset>(nullptr, *AssetPath);
	if (DataAsset == nullptr)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found: %s"), *AssetPath));
	}

	const TSharedPtr<FJsonObject> JsonObject = UBlueprintExtractorLibrary::ExtractDataAssetToJsonObject(DataAsset);
	if (!JsonObject.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to extract DataAsset"));
	}

	FString OutString;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutString);
	FJsonSerializer::Serialize(JsonObject.ToSharedRef(), Writer);
	return OutString;
}

FString UBlueprintExtractorSubsystem::ExtractDataTable(const FString& AssetPath)
{
	UDataTable* DataTable = LoadObject<UDataTable>(nullptr, *AssetPath);
	if (DataTable == nullptr)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found: %s"), *AssetPath));
	}

	const TSharedPtr<FJsonObject> JsonObject = UBlueprintExtractorLibrary::ExtractDataTableToJsonObject(DataTable);
	if (!JsonObject.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to extract DataTable"));
	}

	FString OutString;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutString);
	FJsonSerializer::Serialize(JsonObject.ToSharedRef(), Writer);
	return OutString;
}

FString UBlueprintExtractorSubsystem::ExtractBehaviorTree(const FString& AssetPath)
{
	UBehaviorTree* BehaviorTree = LoadObject<UBehaviorTree>(nullptr, *AssetPath);
	if (BehaviorTree == nullptr)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found: %s"), *AssetPath));
	}

	const TSharedPtr<FJsonObject> JsonObject = UBlueprintExtractorLibrary::ExtractBehaviorTreeToJsonObject(BehaviorTree);
	if (!JsonObject.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to extract BehaviorTree"));
	}

	return SerializeJsonObject(JsonObject);
}

FString UBlueprintExtractorSubsystem::ExtractBlackboard(const FString& AssetPath)
{
	UBlackboardData* BlackboardData = LoadObject<UBlackboardData>(nullptr, *AssetPath);
	if (BlackboardData == nullptr)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found: %s"), *AssetPath));
	}

	const TSharedPtr<FJsonObject> JsonObject = UBlueprintExtractorLibrary::ExtractBlackboardToJsonObject(BlackboardData);
	if (!JsonObject.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to extract Blackboard"));
	}

	return SerializeJsonObject(JsonObject);
}

FString UBlueprintExtractorSubsystem::ExtractUserDefinedStruct(const FString& AssetPath)
{
	UUserDefinedStruct* UserDefinedStruct = LoadObject<UUserDefinedStruct>(nullptr, *AssetPath);
	if (UserDefinedStruct == nullptr)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found: %s"), *AssetPath));
	}

	const TSharedPtr<FJsonObject> JsonObject = UBlueprintExtractorLibrary::ExtractUserDefinedStructToJsonObject(UserDefinedStruct);
	if (!JsonObject.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to extract UserDefinedStruct"));
	}

	return SerializeJsonObject(JsonObject);
}

FString UBlueprintExtractorSubsystem::ExtractUserDefinedEnum(const FString& AssetPath)
{
	UUserDefinedEnum* UserDefinedEnum = LoadObject<UUserDefinedEnum>(nullptr, *AssetPath);
	if (UserDefinedEnum == nullptr)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found: %s"), *AssetPath));
	}

	const TSharedPtr<FJsonObject> JsonObject = UBlueprintExtractorLibrary::ExtractUserDefinedEnumToJsonObject(UserDefinedEnum);
	if (!JsonObject.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to extract UserDefinedEnum"));
	}

	return SerializeJsonObject(JsonObject);
}

FString UBlueprintExtractorSubsystem::ExtractCurve(const FString& AssetPath)
{
	UCurveBase* Curve = LoadObject<UCurveBase>(nullptr, *AssetPath);
	if (Curve == nullptr)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found: %s"), *AssetPath));
	}

	const TSharedPtr<FJsonObject> JsonObject = UBlueprintExtractorLibrary::ExtractCurveToJsonObject(Curve);
	if (!JsonObject.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to extract Curve"));
	}

	return SerializeJsonObject(JsonObject);
}

FString UBlueprintExtractorSubsystem::ExtractCurveTable(const FString& AssetPath)
{
	UCurveTable* CurveTable = LoadObject<UCurveTable>(nullptr, *AssetPath);
	if (CurveTable == nullptr)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found: %s"), *AssetPath));
	}

	const TSharedPtr<FJsonObject> JsonObject = UBlueprintExtractorLibrary::ExtractCurveTableToJsonObject(CurveTable);
	if (!JsonObject.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to extract CurveTable"));
	}

	return SerializeJsonObject(JsonObject);
}

FString UBlueprintExtractorSubsystem::ExtractMaterialInstance(const FString& AssetPath)
{
	UObject* Asset = LoadObject<UMaterialInstance>(nullptr, *AssetPath);
	if (!Asset)
	{
		Asset = LoadObject<UObject>(nullptr, *AssetPath);
	}

	UMaterialInstance* MaterialInstance = Cast<UMaterialInstance>(Asset);
	if (MaterialInstance == nullptr)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found or not a MaterialInstance: %s"), *AssetPath));
	}

	const TSharedPtr<FJsonObject> JsonObject = UBlueprintExtractorLibrary::ExtractMaterialInstanceToJsonObject(MaterialInstance);
	if (!JsonObject.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to extract MaterialInstance"));
	}

	return SerializeJsonObject(JsonObject);
}

FString UBlueprintExtractorSubsystem::ExtractAnimSequence(const FString& AssetPath)
{
	UAnimSequence* AnimSequence = LoadObject<UAnimSequence>(nullptr, *AssetPath);
	if (AnimSequence == nullptr)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found: %s"), *AssetPath));
	}

	const TSharedPtr<FJsonObject> JsonObject = UBlueprintExtractorLibrary::ExtractAnimSequenceToJsonObject(AnimSequence);
	if (!JsonObject.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to extract AnimSequence"));
	}

	return SerializeJsonObject(JsonObject);
}

FString UBlueprintExtractorSubsystem::ExtractAnimMontage(const FString& AssetPath)
{
	UAnimMontage* AnimMontage = LoadObject<UAnimMontage>(nullptr, *AssetPath);
	if (AnimMontage == nullptr)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found: %s"), *AssetPath));
	}

	const TSharedPtr<FJsonObject> JsonObject = UBlueprintExtractorLibrary::ExtractAnimMontageToJsonObject(AnimMontage);
	if (!JsonObject.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to extract AnimMontage"));
	}

	return SerializeJsonObject(JsonObject);
}

FString UBlueprintExtractorSubsystem::ExtractBlendSpace(const FString& AssetPath)
{
	UBlendSpace* BlendSpace = LoadObject<UBlendSpace>(nullptr, *AssetPath);
	if (BlendSpace == nullptr)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found: %s"), *AssetPath));
	}

	const TSharedPtr<FJsonObject> JsonObject = UBlueprintExtractorLibrary::ExtractBlendSpaceToJsonObject(BlendSpace);
	if (!JsonObject.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to extract BlendSpace"));
	}

	return SerializeJsonObject(JsonObject);
}

FString UBlueprintExtractorSubsystem::ExtractCascade(const FString& AssetPathsJson,
                                                      const FString& Scope,
                                                      const int32 MaxDepth,
                                                      const FString& GraphFilter)
{
	TArray<TSharedPtr<FJsonValue>> JsonValues;
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(AssetPathsJson);
		if (!FJsonSerializer::Deserialize(Reader, JsonValues))
		{
			return MakeErrorJson(TEXT("Invalid JSON array for AssetPathsJson"));
		}
	}

	const EBlueprintExtractionScope ParsedScope = ParseScope(Scope);

	// Parse comma-separated graph filter into TArray<FName>
	TArray<FName> ParsedFilter;
	if (!GraphFilter.IsEmpty())
	{
		TArray<FString> Parts;
		GraphFilter.ParseIntoArray(Parts, TEXT(","), true);
		for (const FString& Part : Parts)
		{
			ParsedFilter.Add(FName(*Part.TrimStartAndEnd()));
		}
	}

	TArray<UObject*> LoadedAssets;
	TArray<TSharedPtr<FJsonValue>> SkippedAssets;
	for (const TSharedPtr<FJsonValue>& Value : JsonValues)
	{
		const FString AssetPath = Value->AsString();

		UObject* Asset = LoadObject<UBlueprint>(nullptr, *AssetPath);
		if (Asset == nullptr)
		{
			Asset = LoadObject<UStateTree>(nullptr, *AssetPath);
		}
		if (Asset == nullptr)
		{
			Asset = LoadObject<UBehaviorTree>(nullptr, *AssetPath);
		}
		if (Asset == nullptr)
		{
			Asset = LoadObject<UBlackboardData>(nullptr, *AssetPath);
		}
		if (Asset == nullptr)
		{
			Asset = LoadObject<UDataAsset>(nullptr, *AssetPath);
		}
		if (Asset == nullptr)
		{
			Asset = LoadObject<UDataTable>(nullptr, *AssetPath);
		}
		if (Asset == nullptr)
		{
			Asset = LoadObject<UUserDefinedStruct>(nullptr, *AssetPath);
		}
		if (Asset == nullptr)
		{
			Asset = LoadObject<UUserDefinedEnum>(nullptr, *AssetPath);
		}
		if (Asset == nullptr)
		{
			Asset = LoadObject<UCurveBase>(nullptr, *AssetPath);
		}
		if (Asset == nullptr)
		{
			Asset = LoadObject<UCurveTable>(nullptr, *AssetPath);
		}
		if (Asset == nullptr)
		{
			Asset = LoadObject<UMaterialInstance>(nullptr, *AssetPath);
		}
		if (Asset == nullptr)
		{
			Asset = LoadObject<UAnimSequence>(nullptr, *AssetPath);
		}
		if (Asset == nullptr)
		{
			Asset = LoadObject<UAnimMontage>(nullptr, *AssetPath);
		}
		if (Asset == nullptr)
		{
			Asset = LoadObject<UBlendSpace>(nullptr, *AssetPath);
		}
		if (Asset == nullptr)
		{
			Asset = LoadObject<UObject>(nullptr, *AssetPath);
		}
		if (Asset != nullptr)
		{
			LoadedAssets.Add(Asset);
		}
		else
		{
			const TSharedPtr<FJsonObject> FailedItem = MakeShared<FJsonObject>();
			FailedItem->SetStringField(TEXT("assetPath"), AssetPath);
			FailedItem->SetStringField(TEXT("assetType"), TEXT("Unknown"));
			FailedItem->SetNumberField(TEXT("depth"), 0);
			FailedItem->SetStringField(TEXT("status"), TEXT("skipped"));
			FailedItem->SetStringField(TEXT("error"), TEXT("Failed to load asset"));
			SkippedAssets.Add(MakeShared<FJsonValueObject>(FailedItem));
		}
	}

	const UBlueprintExtractorSettings* Settings = UBlueprintExtractorSettings::Get();
	const FString OutputDir = Settings->GetResolvedOutputDirectoryPath();

	TSharedPtr<FJsonObject> ResultObj = UBlueprintExtractorLibrary::ExtractWithCascade(LoadedAssets, OutputDir, ParsedScope, MaxDepth, ParsedFilter);
	if (!ResultObj.IsValid())
	{
		return MakeErrorJson(TEXT("Cascade extraction failed"));
	}

	TArray<TSharedPtr<FJsonValue>> AssetsArray;
	const TArray<TSharedPtr<FJsonValue>>* ExistingAssets = nullptr;
	if (ResultObj->TryGetArrayField(TEXT("assets"), ExistingAssets) && ExistingAssets)
	{
		AssetsArray = *ExistingAssets;
	}
	AssetsArray.Append(SkippedAssets);
	ResultObj->SetArrayField(TEXT("assets"), AssetsArray);
	ResultObj->SetNumberField(TEXT("total_count"), AssetsArray.Num());
	ResultObj->SetNumberField(TEXT("skipped_count"), SkippedAssets.Num());
	ResultObj->SetStringField(TEXT("output_directory"), OutputDir);
	return SerializeJsonObject(ResultObj);
}

FString UBlueprintExtractorSubsystem::SearchAssets(const FString& Query, const FString& ClassFilter, const int32 MaxResults)
{
	FARFilter Filter;
	Filter.PackagePaths.Add(TEXT("/Game"));
	Filter.bRecursivePaths = true;
	Filter.bIncludeOnlyOnDiskAssets = true;

	bool bRecursiveClasses = false;
	FTopLevelAssetPath ClassPath;
	const bool bFilterResolved = ResolveAssetClassFilter(ClassFilter, ClassPath, bRecursiveClasses);
	if (bFilterResolved)
	{
		Filter.ClassPaths.Add(ClassPath);
		Filter.bRecursiveClasses = bRecursiveClasses;
	}

	TArray<FAssetData> AssetDatas;
	IAssetRegistry::Get()->GetAssets(Filter, AssetDatas);
	AssetDatas.Sort([](const FAssetData& A, const FAssetData& B)
	{
		if (A.AssetName != B.AssetName)
		{
			return A.AssetName.LexicalLess(B.AssetName);
		}

		return A.GetObjectPathString() < B.GetObjectPathString();
	});

	TArray<TSharedPtr<FJsonValue>> ResultArray;
	const int32 ResultLimit = FMath::Max(1, MaxResults);
	for (const FAssetData& AssetData : AssetDatas)
	{
		const FString AssetName  = AssetData.AssetName.ToString();
		const FString AssetClass = AssetData.AssetClassPath.GetAssetName().ToString();

		const bool bNameMatches = Query.IsEmpty() || AssetName.Contains(Query, ESearchCase::IgnoreCase);
		const bool bClassMatches = ClassFilter.IsEmpty()
			|| bFilterResolved
			|| AssetClass.Equals(ClassFilter, ESearchCase::IgnoreCase);

		if (bNameMatches && bClassMatches)
		{
			const TSharedPtr<FJsonObject> AssetObj = MakeShared<FJsonObject>();
			AssetObj->SetStringField(TEXT("path"),  AssetData.GetObjectPathString());
			AssetObj->SetStringField(TEXT("name"),  AssetName);
			AssetObj->SetStringField(TEXT("class"), AssetClass);
			ResultArray.Add(MakeShared<FJsonValueObject>(AssetObj));

			if (ResultArray.Num() >= ResultLimit)
			{
				break;
			}
		}
	}

	const TSharedPtr<FJsonObject> ResultObj = MakeShared<FJsonObject>();
	ResultObj->SetStringField(TEXT("query"), Query);
	ResultObj->SetStringField(TEXT("classFilter"), ClassFilter);
	ResultObj->SetNumberField(TEXT("maxResults"), ResultLimit);
	ResultObj->SetArrayField(TEXT("results"), ResultArray);
	return SerializeJsonObject(ResultObj);
}

FString UBlueprintExtractorSubsystem::ListAssets(const FString& PackagePath,
                                                  const bool bRecursive,
                                                  const FString& ClassFilter)
{
	TArray<TSharedPtr<FJsonValue>> ResultArray;

	// When non-recursive, include immediate subdirectories so users can browse the folder tree
	if (!bRecursive)
	{
		TArray<FString> SubPaths;
		IAssetRegistry::Get()->GetSubPaths(PackagePath, SubPaths, false);
		for (const FString& SubPath : SubPaths)
		{
			const FString FolderName = FPaths::GetCleanFilename(SubPath);
			const TSharedPtr<FJsonObject> FolderObj = MakeShared<FJsonObject>();
			FolderObj->SetStringField(TEXT("path"), SubPath);
			FolderObj->SetStringField(TEXT("name"), FolderName);
			FolderObj->SetStringField(TEXT("class"), TEXT("Folder"));
			ResultArray.Add(MakeShared<FJsonValueObject>(FolderObj));
		}
	}

	TArray<FAssetData> AssetDatas;
	IAssetRegistry::Get()->GetAssetsByPath(FName(*PackagePath), AssetDatas, bRecursive);

	for (const FAssetData& AssetData : AssetDatas)
	{
		const FString AssetClass = AssetData.AssetClassPath.GetAssetName().ToString();

		if (!ClassFilter.IsEmpty() && AssetClass != ClassFilter)
		{
			continue;
		}

		const TSharedPtr<FJsonObject> AssetObj = MakeShared<FJsonObject>();
		AssetObj->SetStringField(TEXT("path"),  AssetData.GetObjectPathString());
		AssetObj->SetStringField(TEXT("name"),  AssetData.AssetName.ToString());
		AssetObj->SetStringField(TEXT("class"), AssetClass);
		ResultArray.Add(MakeShared<FJsonValueObject>(AssetObj));
	}

	FString OutString;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutString);
	FJsonSerializer::Serialize(ResultArray, Writer);
	return OutString;
}

FString UBlueprintExtractorSubsystem::CreateWidgetBlueprint(const FString& AssetPath, const FString& ParentClass)
{
	const TSharedPtr<FJsonObject> Result = FWidgetTreeBuilder::CreateWidgetBlueprint(AssetPath, ParentClass);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to create WidgetBlueprint"));
	}

	FString OutString;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutString);
	FJsonSerializer::Serialize(Result.ToSharedRef(), Writer);
	return OutString;
}

FString UBlueprintExtractorSubsystem::BuildWidgetTree(const FString& AssetPath, const FString& WidgetTreeJson)
{
	UWidgetBlueprint* WidgetBP = LoadObject<UWidgetBlueprint>(nullptr, *AssetPath);
	if (WidgetBP == nullptr)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found or not a WidgetBlueprint: %s"), *AssetPath));
	}

	TSharedPtr<FJsonObject> ParsedJson;
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(WidgetTreeJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedJson) || !ParsedJson.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for WidgetTreeJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FWidgetTreeBuilder::BuildWidgetTree(WidgetBP, ParsedJson);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to build widget tree"));
	}

	FString OutString;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutString);
	FJsonSerializer::Serialize(Result.ToSharedRef(), Writer);
	return OutString;
}

FString UBlueprintExtractorSubsystem::ModifyWidget(const FString& AssetPath,
                                                    const FString& WidgetName,
                                                    const FString& PropertiesJson,
                                                    const FString& SlotJson)
{
	UWidgetBlueprint* WidgetBP = LoadObject<UWidgetBlueprint>(nullptr, *AssetPath);
	if (WidgetBP == nullptr)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found or not a WidgetBlueprint: %s"), *AssetPath));
	}

	TSharedPtr<FJsonObject> ParsedProperties;
	if (!PropertiesJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PropertiesJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedProperties))
		{
			return MakeErrorJson(TEXT("Invalid JSON for PropertiesJson"));
		}
	}
	if (!ParsedProperties.IsValid())
	{
		ParsedProperties = MakeShared<FJsonObject>();
	}

	TSharedPtr<FJsonObject> ParsedSlot;
	if (!SlotJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(SlotJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedSlot))
		{
			return MakeErrorJson(TEXT("Invalid JSON for SlotJson"));
		}
	}
	if (!ParsedSlot.IsValid())
	{
		ParsedSlot = MakeShared<FJsonObject>();
	}

	const TSharedPtr<FJsonObject> Result = FWidgetTreeBuilder::ModifyWidget(WidgetBP, WidgetName, ParsedProperties, ParsedSlot);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to modify widget"));
	}

	FString OutString;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutString);
	FJsonSerializer::Serialize(Result.ToSharedRef(), Writer);
	return OutString;
}

FString UBlueprintExtractorSubsystem::CompileWidgetBlueprint(const FString& AssetPath)
{
	UWidgetBlueprint* WidgetBP = LoadObject<UWidgetBlueprint>(nullptr, *AssetPath);
	if (WidgetBP == nullptr)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found or not a WidgetBlueprint: %s"), *AssetPath));
	}

	const TSharedPtr<FJsonObject> Result = FWidgetTreeBuilder::CompileWidgetBlueprint(WidgetBP);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to compile WidgetBlueprint"));
	}

	FString OutString;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutString);
	FJsonSerializer::Serialize(Result.ToSharedRef(), Writer);
	return OutString;
}
