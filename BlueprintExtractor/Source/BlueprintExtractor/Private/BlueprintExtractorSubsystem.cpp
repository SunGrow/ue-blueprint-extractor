#include "BlueprintExtractorSubsystem.h"
#include "BlueprintExtractorLibrary.h"
#include "BlueprintExtractorSettings.h"
#include "Authoring/AssetMutationHelpers.h"
#include "Authoring/AnimMontageAuthoring.h"
#include "Authoring/AnimSequenceAuthoring.h"
#include "Authoring/BehaviorTreeAuthoring.h"
#include "Authoring/BlackboardAuthoring.h"
#include "Authoring/BlendSpaceAuthoring.h"
#include "Authoring/BlueprintAuthoring.h"
#include "Authoring/CurveAuthoring.h"
#include "Authoring/CurveTableAuthoring.h"
#include "Authoring/DataAssetAuthoring.h"
#include "Authoring/DataTableAuthoring.h"
#include "Import/ImportJobManager.h"
#include "Authoring/MaterialInstanceAuthoring.h"
#include "Authoring/StateTreeAuthoring.h"
#include "Authoring/UserDefinedEnumAuthoring.h"
#include "Authoring/UserDefinedStructAuthoring.h"
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

static FBlueprintExtractorImportJobManager& GetImportJobManager(FBlueprintExtractorImportJobManager*& Manager)
{
	static FBlueprintExtractorImportJobManager* SharedManager = new FBlueprintExtractorImportJobManager();
	Manager = SharedManager;
	return *SharedManager;
}

template <typename AssetType>
static AssetType* LoadAssetByPath(const FString& AssetPath)
{
	return Cast<AssetType>(ResolveAssetByPath(AssetPath));
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

UBlueprintExtractorSubsystem::~UBlueprintExtractorSubsystem()
{
	ImportJobManager = nullptr;
}

FString UBlueprintExtractorSubsystem::ExtractBlueprint(const FString& AssetPath, const FString& Scope, const FString& GraphFilter)
{
	const EBlueprintExtractionScope ParsedScope = ParseScope(Scope);

	UBlueprint* Blueprint = LoadAssetByPath<UBlueprint>(AssetPath);
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
	UStateTree* StateTree = LoadAssetByPath<UStateTree>(AssetPath);
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
	UDataAsset* DataAsset = LoadAssetByPath<UDataAsset>(AssetPath);
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
	UDataTable* DataTable = LoadAssetByPath<UDataTable>(AssetPath);
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
	UBehaviorTree* BehaviorTree = LoadAssetByPath<UBehaviorTree>(AssetPath);
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
	UBlackboardData* BlackboardData = LoadAssetByPath<UBlackboardData>(AssetPath);
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
	UUserDefinedStruct* UserDefinedStruct = LoadAssetByPath<UUserDefinedStruct>(AssetPath);
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
	UUserDefinedEnum* UserDefinedEnum = LoadAssetByPath<UUserDefinedEnum>(AssetPath);
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
	UCurveBase* Curve = LoadAssetByPath<UCurveBase>(AssetPath);
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
	UCurveTable* CurveTable = LoadAssetByPath<UCurveTable>(AssetPath);
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
	UMaterialInstance* MaterialInstance = LoadAssetByPath<UMaterialInstance>(AssetPath);
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
	UAnimSequence* AnimSequence = LoadAssetByPath<UAnimSequence>(AssetPath);
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
	UAnimMontage* AnimMontage = LoadAssetByPath<UAnimMontage>(AssetPath);
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
	UBlendSpace* BlendSpace = LoadAssetByPath<UBlendSpace>(AssetPath);
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

		UObject* Asset = ResolveAssetByPath(AssetPath);
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

FString UBlueprintExtractorSubsystem::BuildWidgetTree(const FString& AssetPath,
                                                      const FString& WidgetTreeJson,
                                                      const bool bValidateOnly)
{
	UWidgetBlueprint* WidgetBP = LoadAssetByPath<UWidgetBlueprint>(AssetPath);
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

	const TSharedPtr<FJsonObject> Result = FWidgetTreeBuilder::BuildWidgetTree(WidgetBP, ParsedJson, bValidateOnly);
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
                                                    const FString& SlotJson,
                                                    const bool bValidateOnly)
{
	UWidgetBlueprint* WidgetBP = LoadAssetByPath<UWidgetBlueprint>(AssetPath);
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

	const TSharedPtr<FJsonObject> Result = FWidgetTreeBuilder::ModifyWidget(WidgetBP, WidgetName, ParsedProperties, ParsedSlot, bValidateOnly);
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
	UWidgetBlueprint* WidgetBP = LoadAssetByPath<UWidgetBlueprint>(AssetPath);
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

FString UBlueprintExtractorSubsystem::SaveAssets(const FString& AssetPathsJson)
{
	TArray<TSharedPtr<FJsonValue>> JsonValues;
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(AssetPathsJson);
		if (!FJsonSerializer::Deserialize(Reader, JsonValues))
		{
			return MakeErrorJson(TEXT("Invalid JSON array for AssetPathsJson"));
		}
	}

	TArray<FString> AssetPaths;
	for (const TSharedPtr<FJsonValue>& Value : JsonValues)
	{
		if (Value.IsValid())
		{
			AssetPaths.Add(Value->AsString());
		}
	}

	const TSharedPtr<FJsonObject> Result = FAssetMutationContext::SaveAssets(AssetPaths);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to save assets"));
	}

	FString OutString;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutString);
	FJsonSerializer::Serialize(Result.ToSharedRef(), Writer);
	return OutString;
}

FString UBlueprintExtractorSubsystem::CreateDataAsset(const FString& AssetPath,
                                                      const FString& AssetClassPath,
                                                      const FString& PropertiesJson,
                                                      const bool bValidateOnly)
{
	TSharedPtr<FJsonObject> ParsedProperties = MakeShared<FJsonObject>();
	if (!PropertiesJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PropertiesJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedProperties) || !ParsedProperties.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PropertiesJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FDataAssetAuthoring::Create(
		AssetPath,
		AssetClassPath,
		ParsedProperties,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to create DataAsset"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::ModifyDataAsset(const FString& AssetPath,
                                                      const FString& PropertiesJson,
                                                      const bool bValidateOnly)
{
	UDataAsset* DataAsset = LoadAssetByPath<UDataAsset>(AssetPath);
	if (!DataAsset)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found or not a DataAsset: %s"), *AssetPath));
	}

	TSharedPtr<FJsonObject> ParsedProperties = MakeShared<FJsonObject>();
	if (!PropertiesJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PropertiesJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedProperties) || !ParsedProperties.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PropertiesJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FDataAssetAuthoring::Modify(
		DataAsset,
		ParsedProperties,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to modify DataAsset"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::CreateDataTable(const FString& AssetPath,
                                                      const FString& RowStructPath,
                                                      const FString& RowsJson,
                                                      const bool bValidateOnly)
{
	TArray<TSharedPtr<FJsonValue>> ParsedRows;
	if (!RowsJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(RowsJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedRows))
		{
			return MakeErrorJson(TEXT("Invalid JSON array for RowsJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FDataTableAuthoring::Create(
		AssetPath,
		RowStructPath,
		ParsedRows,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to create DataTable"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::ModifyDataTable(const FString& AssetPath,
                                                      const FString& PayloadJson,
                                                      const bool bValidateOnly)
{
	UDataTable* DataTable = LoadAssetByPath<UDataTable>(AssetPath);
	if (!DataTable)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found or not a DataTable: %s"), *AssetPath));
	}

	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FDataTableAuthoring::Modify(
		DataTable,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to modify DataTable"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::CreateCurve(const FString& AssetPath,
                                                  const FString& CurveType,
                                                  const FString& ChannelsJson,
                                                  const bool bValidateOnly)
{
	TSharedPtr<FJsonObject> ParsedChannels = MakeShared<FJsonObject>();
	if (!ChannelsJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(ChannelsJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedChannels) || !ParsedChannels.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for ChannelsJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FCurveAuthoring::Create(
		AssetPath,
		CurveType,
		ParsedChannels,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to create curve"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::ModifyCurve(const FString& AssetPath,
                                                  const FString& PayloadJson,
                                                  const bool bValidateOnly)
{
	UCurveBase* Curve = LoadAssetByPath<UCurveBase>(AssetPath);
	if (!Curve)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found or not a Curve asset: %s"), *AssetPath));
	}

	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FCurveAuthoring::Modify(
		Curve,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to modify curve"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::CreateCurveTable(const FString& AssetPath,
                                                       const FString& CurveTableMode,
                                                       const FString& RowsJson,
                                                       const bool bValidateOnly)
{
	TArray<TSharedPtr<FJsonValue>> ParsedRows;
	if (!RowsJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(RowsJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedRows))
		{
			return MakeErrorJson(TEXT("Invalid JSON array for RowsJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FCurveTableAuthoring::Create(
		AssetPath,
		CurveTableMode,
		ParsedRows,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to create CurveTable"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::ModifyCurveTable(const FString& AssetPath,
                                                       const FString& PayloadJson,
                                                       const bool bValidateOnly)
{
	UCurveTable* CurveTable = LoadAssetByPath<UCurveTable>(AssetPath);
	if (!CurveTable)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found or not a CurveTable: %s"), *AssetPath));
	}

	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FCurveTableAuthoring::Modify(
		CurveTable,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to modify CurveTable"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::CreateMaterialInstance(const FString& AssetPath,
                                                             const FString& ParentMaterialPath,
                                                             const bool bValidateOnly)
{
	const TSharedPtr<FJsonObject> Result = FMaterialInstanceAuthoring::Create(
		AssetPath,
		ParentMaterialPath,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to create MaterialInstance"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::ModifyMaterialInstance(const FString& AssetPath,
                                                             const FString& PayloadJson,
                                                             const bool bValidateOnly)
{
	UMaterialInstance* MaterialInstance = LoadAssetByPath<UMaterialInstance>(AssetPath);
	if (!MaterialInstance)
	{
		return MakeErrorJson(FString::Printf(TEXT("Asset not found or not a MaterialInstance: %s"), *AssetPath));
	}

	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FMaterialInstanceAuthoring::Modify(
		MaterialInstance,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to modify MaterialInstance"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::CreateUserDefinedStruct(
	const FString& AssetPath,
	const FString& PayloadJson,
	const bool bValidateOnly)
{
	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FUserDefinedStructAuthoring::Create(
		AssetPath,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to create UserDefinedStruct"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::ModifyUserDefinedStruct(
	const FString& AssetPath,
	const FString& Operation,
	const FString& PayloadJson,
	const bool bValidateOnly)
{
	UUserDefinedStruct* UserDefinedStruct = LoadAssetByPath<UUserDefinedStruct>(AssetPath);
	if (!UserDefinedStruct)
	{
		return MakeErrorJson(
			FString::Printf(TEXT("Asset not found or not a UserDefinedStruct: %s"), *AssetPath));
	}

	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FUserDefinedStructAuthoring::Modify(
		UserDefinedStruct,
		Operation,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to modify UserDefinedStruct"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::CreateUserDefinedEnum(
	const FString& AssetPath,
	const FString& PayloadJson,
	const bool bValidateOnly)
{
	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FUserDefinedEnumAuthoring::Create(
		AssetPath,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to create UserDefinedEnum"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::ModifyUserDefinedEnum(
	const FString& AssetPath,
	const FString& Operation,
	const FString& PayloadJson,
	const bool bValidateOnly)
{
	UUserDefinedEnum* UserDefinedEnum = LoadAssetByPath<UUserDefinedEnum>(AssetPath);
	if (!UserDefinedEnum)
	{
		return MakeErrorJson(
			FString::Printf(TEXT("Asset not found or not a UserDefinedEnum: %s"), *AssetPath));
	}

	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FUserDefinedEnumAuthoring::Modify(
		UserDefinedEnum,
		Operation,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to modify UserDefinedEnum"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::CreateBlackboard(
	const FString& AssetPath,
	const FString& PayloadJson,
	const bool bValidateOnly)
{
	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FBlackboardAuthoring::Create(
		AssetPath,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to create Blackboard"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::ModifyBlackboard(
	const FString& AssetPath,
	const FString& Operation,
	const FString& PayloadJson,
	const bool bValidateOnly)
{
	UBlackboardData* BlackboardData = LoadAssetByPath<UBlackboardData>(AssetPath);
	if (!BlackboardData)
	{
		return MakeErrorJson(
			FString::Printf(TEXT("Asset not found or not a BlackboardData: %s"), *AssetPath));
	}

	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FBlackboardAuthoring::Modify(
		BlackboardData,
		Operation,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to modify Blackboard"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::CreateBehaviorTree(
	const FString& AssetPath,
	const FString& PayloadJson,
	const bool bValidateOnly)
{
	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FBehaviorTreeAuthoring::Create(
		AssetPath,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to create BehaviorTree"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::ModifyBehaviorTree(
	const FString& AssetPath,
	const FString& Operation,
	const FString& PayloadJson,
	const bool bValidateOnly)
{
	UBehaviorTree* BehaviorTree = LoadAssetByPath<UBehaviorTree>(AssetPath);
	if (!BehaviorTree)
	{
		return MakeErrorJson(
			FString::Printf(TEXT("Asset not found or not a BehaviorTree: %s"), *AssetPath));
	}

	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FBehaviorTreeAuthoring::Modify(
		BehaviorTree,
		Operation,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to modify BehaviorTree"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::CreateStateTree(
	const FString& AssetPath,
	const FString& PayloadJson,
	const bool bValidateOnly)
{
	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FStateTreeAuthoring::Create(
		AssetPath,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to create StateTree"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::ModifyStateTree(
	const FString& AssetPath,
	const FString& Operation,
	const FString& PayloadJson,
	const bool bValidateOnly)
{
	UStateTree* StateTree = LoadAssetByPath<UStateTree>(AssetPath);
	if (!StateTree)
	{
		return MakeErrorJson(
			FString::Printf(TEXT("Asset not found or not a StateTree: %s"), *AssetPath));
	}

	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FStateTreeAuthoring::Modify(
		StateTree,
		Operation,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to modify StateTree"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::CreateAnimSequence(
	const FString& AssetPath,
	const FString& PayloadJson,
	const bool bValidateOnly)
{
	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FAnimSequenceAuthoring::Create(
		AssetPath,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to create AnimSequence"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::ModifyAnimSequence(
	const FString& AssetPath,
	const FString& Operation,
	const FString& PayloadJson,
	const bool bValidateOnly)
{
	UAnimSequence* AnimSequence = LoadAssetByPath<UAnimSequence>(AssetPath);
	if (!AnimSequence)
	{
		return MakeErrorJson(
			FString::Printf(TEXT("Asset not found or not an AnimSequence: %s"), *AssetPath));
	}

	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FAnimSequenceAuthoring::Modify(
		AnimSequence,
		Operation,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to modify AnimSequence"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::CreateAnimMontage(
	const FString& AssetPath,
	const FString& PayloadJson,
	const bool bValidateOnly)
{
	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FAnimMontageAuthoring::Create(
		AssetPath,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to create AnimMontage"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::ModifyAnimMontage(
	const FString& AssetPath,
	const FString& Operation,
	const FString& PayloadJson,
	const bool bValidateOnly)
{
	UAnimMontage* AnimMontage = LoadAssetByPath<UAnimMontage>(AssetPath);
	if (!AnimMontage)
	{
		return MakeErrorJson(
			FString::Printf(TEXT("Asset not found or not an AnimMontage: %s"), *AssetPath));
	}

	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FAnimMontageAuthoring::Modify(
		AnimMontage,
		Operation,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to modify AnimMontage"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::CreateBlendSpace(
	const FString& AssetPath,
	const FString& PayloadJson,
	const bool bValidateOnly)
{
	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FBlendSpaceAuthoring::Create(
		AssetPath,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to create BlendSpace"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::ModifyBlendSpace(
	const FString& AssetPath,
	const FString& Operation,
	const FString& PayloadJson,
	const bool bValidateOnly)
{
	UBlendSpace* BlendSpace = LoadAssetByPath<UBlendSpace>(AssetPath);
	if (!BlendSpace)
	{
		return MakeErrorJson(
			FString::Printf(TEXT("Asset not found or not a BlendSpace: %s"), *AssetPath));
	}

	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FBlendSpaceAuthoring::Modify(
		BlendSpace,
		Operation,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to modify BlendSpace"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::CreateBlueprint(
	const FString& AssetPath,
	const FString& ParentClassPath,
	const FString& PayloadJson,
	const bool bValidateOnly)
{
	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FBlueprintAuthoring::Create(
		AssetPath,
		ParentClassPath,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to create Blueprint"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::ModifyBlueprintMembers(
	const FString& AssetPath,
	const FString& Operation,
	const FString& PayloadJson,
	const bool bValidateOnly)
{
	UBlueprint* Blueprint = LoadAssetByPath<UBlueprint>(AssetPath);
	if (!Blueprint)
	{
		return MakeErrorJson(
			FString::Printf(TEXT("Asset not found or not a Blueprint: %s"), *AssetPath));
	}

	TSharedPtr<FJsonObject> ParsedPayload = MakeShared<FJsonObject>();
	if (!PayloadJson.IsEmpty())
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(PayloadJson);
		if (!FJsonSerializer::Deserialize(Reader, ParsedPayload) || !ParsedPayload.IsValid())
		{
			return MakeErrorJson(TEXT("Invalid JSON for PayloadJson"));
		}
	}

	const TSharedPtr<FJsonObject> Result = FBlueprintAuthoring::Modify(
		Blueprint,
		Operation,
		ParsedPayload,
		bValidateOnly);
	if (!Result.IsValid())
	{
		return MakeErrorJson(TEXT("Failed to modify Blueprint members"));
	}

	return SerializeJsonObject(Result);
}

FString UBlueprintExtractorSubsystem::ImportAssets(const FString& PayloadJson, const bool bValidateOnly)
{
	return SerializeJsonObject(
		GetImportJobManager(ImportJobManager).EnqueueImportJob(
			TEXT("import_assets"),
			PayloadJson,
			bValidateOnly));
}

FString UBlueprintExtractorSubsystem::ReimportAssets(const FString& PayloadJson, const bool bValidateOnly)
{
	return SerializeJsonObject(
		GetImportJobManager(ImportJobManager).EnqueueReimportJob(
			TEXT("reimport_assets"),
			PayloadJson,
			bValidateOnly));
}

FString UBlueprintExtractorSubsystem::ImportTextures(const FString& PayloadJson, const bool bValidateOnly)
{
	return SerializeJsonObject(
		GetImportJobManager(ImportJobManager).EnqueueTextureImportJob(
			TEXT("import_textures"),
			PayloadJson,
			bValidateOnly));
}

FString UBlueprintExtractorSubsystem::ImportMeshes(const FString& PayloadJson, const bool bValidateOnly)
{
	return SerializeJsonObject(
		GetImportJobManager(ImportJobManager).EnqueueMeshImportJob(
			TEXT("import_meshes"),
			PayloadJson,
			bValidateOnly));
}

FString UBlueprintExtractorSubsystem::GetImportJob(const FString& JobId)
{
	return SerializeJsonObject(
		GetImportJobManager(ImportJobManager).GetImportJob(JobId));
}

FString UBlueprintExtractorSubsystem::ListImportJobs(const bool bIncludeCompleted)
{
	return SerializeJsonObject(
		GetImportJobManager(ImportJobManager).ListImportJobs(bIncludeCompleted));
}
