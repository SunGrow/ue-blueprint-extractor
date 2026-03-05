#pragma once

#include "CoreMinimal.h"
#include "BlueprintExtractorTypes.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "BlueprintExtractorLibrary.generated.h"

class UBlueprint;
class UStateTree;

UCLASS()
class BLUEPRINTEXTRACTOR_API UBlueprintExtractorLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor", meta=(DevelopmentOnly))
	static bool ExtractBlueprintToJson(UBlueprint* Blueprint, const FString& OutputPath, EBlueprintExtractionScope Scope);

	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor", meta=(DevelopmentOnly))
	static bool ExtractBlueprintToJsonString(UBlueprint* Blueprint, FString& OutJsonString, EBlueprintExtractionScope Scope);

	static TSharedPtr<FJsonObject> ExtractBlueprintToJsonObject(UBlueprint* Blueprint, EBlueprintExtractionScope Scope);

	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor", meta=(DevelopmentOnly))
	static bool ExtractStateTreeToJson(UStateTree* StateTree, const FString& OutputPath);

	static TSharedPtr<FJsonObject> ExtractStateTreeToJsonObject(UStateTree* StateTree);

	/** Extract assets with cascade: follows references to other extractable assets (Blueprints, StateTrees). */
	static int32 ExtractWithCascade(const TArray<UObject*>& InitialAssets, const FString& OutputDir, EBlueprintExtractionScope Scope, int32 MaxDepth);

private:
	static TArray<FSoftObjectPath> CollectBlueprintReferences(const UBlueprint* Blueprint);
	static TArray<FSoftObjectPath> CollectStateTreeReferences(const UStateTree* StateTree);
};
