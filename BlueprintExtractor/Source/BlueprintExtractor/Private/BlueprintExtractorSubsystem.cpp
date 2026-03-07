#include "BlueprintExtractorSubsystem.h"
#include "BlueprintExtractorLibrary.h"
#include "BlueprintExtractorSettings.h"
#include "Engine/Blueprint.h"
#include "Engine/DataAsset.h"
#include "Engine/DataTable.h"
#include "StateTree.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "AssetRegistry/IAssetRegistry.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Serialization/JsonReader.h"

static FString MakeErrorJson(const FString& Message)
{
	const TSharedPtr<FJsonObject> ErrorObj = MakeShared<FJsonObject>();
	ErrorObj->SetStringField(TEXT("error"), Message);

	FString OutString;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutString);
	FJsonSerializer::Serialize(ErrorObj.ToSharedRef(), Writer);
	return OutString;
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
			Asset = LoadObject<UDataAsset>(nullptr, *AssetPath);
		}
		if (Asset == nullptr)
		{
			Asset = LoadObject<UDataTable>(nullptr, *AssetPath);
		}
		if (Asset == nullptr)
		{
			Asset = LoadObject<UObject>(nullptr, *AssetPath);
		}
		if (Asset != nullptr)
		{
			LoadedAssets.Add(Asset);
		}
	}

	const UBlueprintExtractorSettings* Settings = UBlueprintExtractorSettings::Get();
	const FString OutputDir = Settings->OutputDirectory.Path;
	const FString AbsOutputDir = FPaths::ConvertRelativePathToFull(OutputDir);

	const int32 ExtractedCount = UBlueprintExtractorLibrary::ExtractWithCascade(LoadedAssets, OutputDir, ParsedScope, MaxDepth, ParsedFilter);

	const TSharedPtr<FJsonObject> ResultObj = MakeShared<FJsonObject>();
	ResultObj->SetNumberField(TEXT("extracted_count"), ExtractedCount);
	ResultObj->SetStringField(TEXT("output_directory"), AbsOutputDir);

	FString OutString;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutString);
	FJsonSerializer::Serialize(ResultObj.ToSharedRef(), Writer);
	return OutString;
}

FString UBlueprintExtractorSubsystem::SearchAssets(const FString& Query, const FString& ClassFilter)
{
	TArray<FAssetData> AssetDatas;
	IAssetRegistry::Get()->GetAllAssets(AssetDatas);

	TArray<TSharedPtr<FJsonValue>> ResultArray;
	for (const FAssetData& AssetData : AssetDatas)
	{
		const FString AssetName  = AssetData.AssetName.ToString();
		const FString AssetClass = AssetData.AssetClassPath.GetAssetName().ToString();

		const bool bNameMatches  = AssetName.Contains(Query);
		const bool bClassMatches = ClassFilter.IsEmpty() || AssetClass == ClassFilter;

		if (bNameMatches && bClassMatches)
		{
			const TSharedPtr<FJsonObject> AssetObj = MakeShared<FJsonObject>();
			AssetObj->SetStringField(TEXT("path"),  AssetData.GetObjectPathString());
			AssetObj->SetStringField(TEXT("name"),  AssetName);
			AssetObj->SetStringField(TEXT("class"), AssetClass);
			ResultArray.Add(MakeShared<FJsonValueObject>(AssetObj));
		}
	}

	FString OutString;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutString);
	FJsonSerializer::Serialize(ResultArray, Writer);
	return OutString;
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
