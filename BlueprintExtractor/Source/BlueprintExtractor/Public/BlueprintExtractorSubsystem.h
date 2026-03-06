#pragma once

#include "CoreMinimal.h"
#include "EditorSubsystem.h"

#include "BlueprintExtractorTypes.h"

#include "BlueprintExtractorSubsystem.generated.h"

/** Editor subsystem exposing blueprint extraction as string-based methods
 *  for remote invocation via the Web Remote Control API. */
UCLASS()
class BLUEPRINTEXTRACTOR_API UBlueprintExtractorSubsystem : public UEditorSubsystem
{
	GENERATED_BODY()

// ============================================================
// Private Functions
// ============================================================
private:
	static EBlueprintExtractionScope ParseScope(const FString& ScopeString);

// ============================================================
// Public Interface
// ============================================================
public:
	/** Extracts a Blueprint asset to a JSON string. Returns an error JSON object on failure.
	 *  GraphFilter is a comma-separated list of graph names to extract. Empty = all graphs. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ExtractBlueprint(const FString& AssetPath, const FString& Scope = TEXT("Full"), const FString& GraphFilter = TEXT(""));

	/** Extracts a StateTree asset to a JSON string. Returns an error JSON object on failure. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ExtractStateTree(const FString& AssetPath);

	/** Extracts a DataAsset to a JSON string. Returns an error JSON object on failure. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ExtractDataAsset(const FString& AssetPath);

	/** Extracts a DataTable to a JSON string. Returns an error JSON object on failure. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ExtractDataTable(const FString& AssetPath);

	/** Extracts multiple assets with cascade reference following. Returns extraction summary JSON. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ExtractCascade(const FString& AssetPathsJson,
	                       const FString& Scope = TEXT("Full"),
	                       const int32 MaxDepth = 3);

	/** Searches assets by name query and optional class filter. Returns a JSON array. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString SearchAssets(const FString& Query, const FString& ClassFilter = TEXT("Blueprint"));

	/** Lists assets under a package path. Returns a JSON array. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ListAssets(const FString& PackagePath,
	                   const bool bRecursive = true,
	                   const FString& ClassFilter = TEXT(""));
};
