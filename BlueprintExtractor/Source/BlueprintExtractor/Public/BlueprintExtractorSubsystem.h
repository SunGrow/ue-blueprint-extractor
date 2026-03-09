#pragma once

#include "CoreMinimal.h"
#include "EditorSubsystem.h"

#include "BlueprintExtractorTypes.h"

#include "BlueprintExtractorSubsystem.generated.h"

class FBlueprintExtractorImportJobManager;

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
	FBlueprintExtractorImportJobManager* ImportJobManager = nullptr;

// ============================================================
// Public Interface
// ============================================================
public:
	virtual ~UBlueprintExtractorSubsystem() override;

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

	/** Extracts a BehaviorTree to a JSON string. Returns an error JSON object on failure. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ExtractBehaviorTree(const FString& AssetPath);

	/** Extracts a Blackboard asset to a JSON string. Returns an error JSON object on failure. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ExtractBlackboard(const FString& AssetPath);

	/** Extracts a UserDefinedStruct asset to a JSON string. Returns an error JSON object on failure. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ExtractUserDefinedStruct(const FString& AssetPath);

	/** Extracts a UserDefinedEnum asset to a JSON string. Returns an error JSON object on failure. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ExtractUserDefinedEnum(const FString& AssetPath);

	/** Extracts a curve asset to a JSON string. Returns an error JSON object on failure. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ExtractCurve(const FString& AssetPath);

	/** Extracts a CurveTable asset to a JSON string. Returns an error JSON object on failure. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ExtractCurveTable(const FString& AssetPath);

	/** Extracts a MaterialInstance asset to a JSON string. Returns an error JSON object on failure. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ExtractMaterialInstance(const FString& AssetPath);

	/** Extracts an AnimSequence asset to a JSON string. Returns an error JSON object on failure. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ExtractAnimSequence(const FString& AssetPath);

	/** Extracts an AnimMontage asset to a JSON string. Returns an error JSON object on failure. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ExtractAnimMontage(const FString& AssetPath);

	/** Extracts a BlendSpace asset to a JSON string. Returns an error JSON object on failure. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ExtractBlendSpace(const FString& AssetPath);

	/** Extracts multiple assets with cascade reference following. Returns extraction summary JSON.
	 *  GraphFilter is a comma-separated list of graph names to extract. Empty = all graphs. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ExtractCascade(const FString& AssetPathsJson,
	                       const FString& Scope = TEXT("Full"),
	                       const int32 MaxDepth = 3,
	                       const FString& GraphFilter = TEXT(""));

	/** Searches assets by name query and optional class filter. Returns a JSON array. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString SearchAssets(const FString& Query, const FString& ClassFilter = TEXT("Blueprint"), const int32 MaxResults = 50);

	/** Lists assets under a package path. Returns a JSON array. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ListAssets(const FString& PackagePath,
	                   const bool bRecursive = true,
	                   const FString& ClassFilter = TEXT(""));

	/** Creates a new WidgetBlueprint asset. Returns JSON with asset path and status. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString CreateWidgetBlueprint(const FString& AssetPath, const FString& ParentClass);

	/** Builds/replaces the entire widget hierarchy from JSON. Returns JSON with widget count and errors. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString BuildWidgetTree(const FString& AssetPath,
	                        const FString& WidgetTreeJson,
	                        const bool bValidateOnly = false);

	/** Patches properties on an existing widget. Returns JSON with success/error. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ModifyWidget(const FString& AssetPath,
	                     const FString& WidgetName,
	                     const FString& PropertiesJson,
	                     const FString& SlotJson,
	                     const bool bValidateOnly = false);

	/** Compiles a WidgetBlueprint. Returns JSON array of errors/warnings. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString CompileWidgetBlueprint(const FString& AssetPath);

	/** Saves one or more dirty asset packages explicitly. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString SaveAssets(const FString& AssetPathsJson);

	/** Creates a new DataAsset of the specified concrete class. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString CreateDataAsset(const FString& AssetPath,
	                        const FString& AssetClassPath,
	                        const FString& PropertiesJson = TEXT(""),
	                        const bool bValidateOnly = false);

	/** Applies a reflected property patch to an existing DataAsset. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ModifyDataAsset(const FString& AssetPath,
	                        const FString& PropertiesJson,
	                        const bool bValidateOnly = false);

	/** Creates a new DataTable with the specified row struct and optional rows. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString CreateDataTable(const FString& AssetPath,
	                        const FString& RowStructPath,
	                        const FString& RowsJson = TEXT("[]"),
	                        const bool bValidateOnly = false);

	/** Upserts, deletes, or replaces rows in an existing DataTable. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ModifyDataTable(const FString& AssetPath,
	                        const FString& PayloadJson,
	                        const bool bValidateOnly = false);

	/** Creates a new curve asset of the specified concrete curve type. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString CreateCurve(const FString& AssetPath,
	                    const FString& CurveType,
	                    const FString& ChannelsJson = TEXT("{}"),
	                    const bool bValidateOnly = false);

	/** Modifies an existing curve asset by patching channels and key operations. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ModifyCurve(const FString& AssetPath,
	                    const FString& PayloadJson,
	                    const bool bValidateOnly = false);

	/** Creates a new CurveTable with the specified mode and optional rows. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString CreateCurveTable(const FString& AssetPath,
	                         const FString& CurveTableMode,
	                         const FString& RowsJson = TEXT("[]"),
	                         const bool bValidateOnly = false);

	/** Upserts, deletes, or replaces rows in an existing CurveTable. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ModifyCurveTable(const FString& AssetPath,
	                         const FString& PayloadJson,
	                         const bool bValidateOnly = false);

	/** Creates a new MaterialInstanceConstant from a parent material/interface. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString CreateMaterialInstance(const FString& AssetPath,
	                               const FString& ParentMaterialPath,
	                               const bool bValidateOnly = false);

	/** Applies material override operations to an existing MaterialInstanceConstant. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ModifyMaterialInstance(const FString& AssetPath,
	                               const FString& PayloadJson,
	                               const bool bValidateOnly = false);

	/** Creates a new UserDefinedStruct asset from extractor-shaped field payloads. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString CreateUserDefinedStruct(const FString& AssetPath,
	                                const FString& PayloadJson = TEXT(""),
	                                const bool bValidateOnly = false);

	/** Modifies an existing UserDefinedStruct with field-level operations. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ModifyUserDefinedStruct(const FString& AssetPath,
	                                const FString& Operation,
	                                const FString& PayloadJson = TEXT(""),
	                                const bool bValidateOnly = false);

	/** Creates a new UserDefinedEnum asset from extractor-shaped entry payloads. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString CreateUserDefinedEnum(const FString& AssetPath,
	                              const FString& PayloadJson = TEXT(""),
	                              const bool bValidateOnly = false);

	/** Modifies an existing UserDefinedEnum with entry-level operations. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ModifyUserDefinedEnum(const FString& AssetPath,
	                              const FString& Operation,
	                              const FString& PayloadJson = TEXT(""),
	                              const bool bValidateOnly = false);

	/** Creates a new Blackboard asset from extractor-shaped key payloads. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString CreateBlackboard(const FString& AssetPath,
	                         const FString& PayloadJson = TEXT(""),
	                         const bool bValidateOnly = false);

	/** Modifies an existing Blackboard asset with declarative key operations. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ModifyBlackboard(const FString& AssetPath,
	                         const FString& Operation,
	                         const FString& PayloadJson = TEXT(""),
	                         const bool bValidateOnly = false);

	/** Creates a new BehaviorTree asset from extractor-shaped tree payloads. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString CreateBehaviorTree(const FString& AssetPath,
	                           const FString& PayloadJson = TEXT(""),
	                           const bool bValidateOnly = false);

	/** Modifies an existing BehaviorTree asset with declarative tree operations. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ModifyBehaviorTree(const FString& AssetPath,
	                           const FString& Operation,
	                           const FString& PayloadJson = TEXT(""),
	                           const bool bValidateOnly = false);

	/** Creates a new StateTree asset from extractor-shaped tree payloads. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString CreateStateTree(const FString& AssetPath,
	                        const FString& PayloadJson = TEXT(""),
	                        const bool bValidateOnly = false);

	/** Modifies an existing StateTree asset with declarative tree operations. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ModifyStateTree(const FString& AssetPath,
	                        const FString& Operation,
	                        const FString& PayloadJson = TEXT(""),
	                        const bool bValidateOnly = false);

	/** Creates a new AnimSequence asset from extractor-shaped metadata payloads. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString CreateAnimSequence(const FString& AssetPath,
	                           const FString& PayloadJson = TEXT(""),
	                           const bool bValidateOnly = false);

	/** Modifies an existing AnimSequence asset with metadata authoring operations. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ModifyAnimSequence(const FString& AssetPath,
	                           const FString& Operation,
	                           const FString& PayloadJson = TEXT(""),
	                           const bool bValidateOnly = false);

	/** Creates a new AnimMontage asset from extractor-shaped metadata payloads. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString CreateAnimMontage(const FString& AssetPath,
	                          const FString& PayloadJson = TEXT(""),
	                          const bool bValidateOnly = false);

	/** Modifies an existing AnimMontage asset with metadata authoring operations. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ModifyAnimMontage(const FString& AssetPath,
	                          const FString& Operation,
	                          const FString& PayloadJson = TEXT(""),
	                          const bool bValidateOnly = false);

	/** Creates a new BlendSpace asset from extractor-shaped sample and axis payloads. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString CreateBlendSpace(const FString& AssetPath,
	                         const FString& PayloadJson = TEXT(""),
	                         const bool bValidateOnly = false);

	/** Modifies an existing BlendSpace asset with sample and axis operations. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ModifyBlendSpace(const FString& AssetPath,
	                         const FString& Operation,
	                         const FString& PayloadJson = TEXT(""),
	                         const bool bValidateOnly = false);

	/** Creates a new Blueprint asset with optional member payloads. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString CreateBlueprint(const FString& AssetPath,
	                        const FString& ParentClassPath,
	                        const FString& PayloadJson = TEXT(""),
	                        const bool bValidateOnly = false);

	/** Modifies member authoring surfaces on an existing Blueprint asset. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ModifyBlueprintMembers(const FString& AssetPath,
	                               const FString& Operation,
	                               const FString& PayloadJson = TEXT(""),
	                               const bool bValidateOnly = false);

	/** Enqueues a generic async import job. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ImportAssets(const FString& PayloadJson, const bool bValidateOnly = false);

	/** Enqueues an async reimport job for explicit asset paths. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ReimportAssets(const FString& PayloadJson, const bool bValidateOnly = false);

	/** Enqueues an async texture-focused import job. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ImportTextures(const FString& PayloadJson, const bool bValidateOnly = false);

	/** Enqueues an async mesh-focused import job. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ImportMeshes(const FString& PayloadJson, const bool bValidateOnly = false);

	/** Returns the current state of a previously enqueued import job. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString GetImportJob(const FString& JobId);

	/** Lists session-scoped import jobs. */
	UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
	FString ListImportJobs(const bool bIncludeCompleted = true);
};
