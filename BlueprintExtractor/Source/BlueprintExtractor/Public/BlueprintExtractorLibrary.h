#pragma once

#include "CoreMinimal.h"
#include "BlueprintExtractorTypes.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "BlueprintExtractorLibrary.generated.h"

class UBlueprint;
class UStateTree;
class UDataAsset;
class UDataTable;

UCLASS()
class BLUEPRINTEXTRACTOR_API UBlueprintExtractorLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor", meta=(DevelopmentOnly))
	static bool ExtractBlueprintToJson(UBlueprint* Blueprint, const FString& OutputPath, EBlueprintExtractionScope Scope, const TArray<FName>& GraphFilter);

	static bool ExtractBlueprintToJson(UBlueprint* Blueprint, const FString& OutputPath, EBlueprintExtractionScope Scope)
	{ return ExtractBlueprintToJson(Blueprint, OutputPath, Scope, TArray<FName>()); }

	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor", meta=(DevelopmentOnly))
	static bool ExtractBlueprintToJsonString(UBlueprint* Blueprint, FString& OutJsonString, EBlueprintExtractionScope Scope, const TArray<FName>& GraphFilter);

	static bool ExtractBlueprintToJsonString(UBlueprint* Blueprint, FString& OutJsonString, EBlueprintExtractionScope Scope)
	{ return ExtractBlueprintToJsonString(Blueprint, OutJsonString, Scope, TArray<FName>()); }

	static TSharedPtr<FJsonObject> ExtractBlueprintToJsonObject(UBlueprint* Blueprint, EBlueprintExtractionScope Scope, const TArray<FName>& GraphFilter = {});

	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor", meta=(DevelopmentOnly))
	static bool ExtractStateTreeToJson(UStateTree* StateTree, const FString& OutputPath);

	static TSharedPtr<FJsonObject> ExtractStateTreeToJsonObject(UStateTree* StateTree);

	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor", meta=(DevelopmentOnly))
	static bool ExtractDataAssetToJson(UDataAsset* DataAsset, const FString& OutputPath);

	static TSharedPtr<FJsonObject> ExtractDataAssetToJsonObject(UDataAsset* DataAsset);

	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor", meta=(DevelopmentOnly))
	static bool ExtractDataTableToJson(UDataTable* DataTable, const FString& OutputPath);

	static TSharedPtr<FJsonObject> ExtractDataTableToJsonObject(UDataTable* DataTable);

	/** Extract assets with cascade: follows references to other extractable assets (Blueprints, StateTrees).
	 *  GraphFilter limits which graphs are extracted from Blueprints. Empty = all graphs. */
	static int32 ExtractWithCascade(const TArray<UObject*>& InitialAssets, const FString& OutputDir, EBlueprintExtractionScope Scope, int32 MaxDepth, const TArray<FName>& GraphFilter = {});

private:
	static TArray<FSoftObjectPath> CollectBlueprintReferences(const UBlueprint* Blueprint);
	static TArray<FSoftObjectPath> CollectStateTreeReferences(const UStateTree* StateTree);
};
