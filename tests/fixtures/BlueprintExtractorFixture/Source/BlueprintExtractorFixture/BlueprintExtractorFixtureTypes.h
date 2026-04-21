#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "Engine/DataAsset.h"
#include "Engine/DataTable.h"
#include "Materials/MaterialInterface.h"

#include "BlueprintExtractorFixtureTypes.generated.h"

class UButton;
class UImage;
class UNamedSlot;
class UTextBlock;
class UWidget;
class UBlueprintExtractorFixtureInlineObject;

UCLASS(BlueprintType, EditInlineNew, DefaultToInstanced)
class BLUEPRINTEXTRACTORFIXTURE_API UBlueprintExtractorFixtureInlineObject : public UObject
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Fixture")
	FString Label = TEXT("Inline");

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Fixture")
	int32 Count = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Instanced, Category = "Fixture")
	TObjectPtr<UBlueprintExtractorFixtureInlineObject> Child = nullptr;
};

/**
 * Alternate concrete inline-object class, used to test class swaps on existing
 * Instanced UObject properties (e.g. FPropertySerializer ActionTemplate rebinding).
 */
UCLASS(BlueprintType, EditInlineNew, DefaultToInstanced)
class BLUEPRINTEXTRACTORFIXTURE_API UBlueprintExtractorFixtureInlineObjectAlt : public UBlueprintExtractorFixtureInlineObject
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Fixture")
	FString AltTag = TEXT("Alt");
};

/**
 * Struct containing an Instanced UObject field — mimics project patterns like
 * FCameraOperatorActionRule where a struct owns a TObjectPtr<> with Instanced.
 * Serves as the TMap value in FixtureDataAsset.InlineObjectMap.
 */
USTRUCT(BlueprintType)
struct BLUEPRINTEXTRACTORFIXTURE_API FBlueprintExtractorFixtureInlineStruct
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Fixture")
	FString Description = TEXT("");

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Instanced, Category = "Fixture")
	TObjectPtr<UBlueprintExtractorFixtureInlineObject> InlineValue = nullptr;
};

USTRUCT(BlueprintType)
struct BLUEPRINTEXTRACTORFIXTURE_API FBlueprintExtractorFixtureRow : public FTableRowBase
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Fixture")
	int32 Count = 0;
};

UCLASS(BlueprintType)
class BLUEPRINTEXTRACTORFIXTURE_API UBlueprintExtractorFixtureDataAsset : public UDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Fixture")
	int32 Count = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Instanced, Category = "Fixture")
	TObjectPtr<UBlueprintExtractorFixtureInlineObject> InlineObject = nullptr;

	// Exercises TMap merge semantics and struct-with-Instanced-field authoring.
	// Key is FName (serialised as plain string in export text).
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Fixture")
	TMap<FName, FBlueprintExtractorFixtureInlineStruct> InlineObjectMap;
};

UCLASS(BlueprintType)
class BLUEPRINTEXTRACTORFIXTURE_API UBlueprintExtractorFixtureBindWidgetParent : public UUserWidget
{
	GENERATED_BODY()

protected:
	UPROPERTY(meta = (BindWidget))
	TObjectPtr<UWidget> TitleBarArea = nullptr;

	UPROPERTY(meta = (BindWidget))
	TObjectPtr<UTextBlock> TitleText = nullptr;

	UPROPERTY(meta = (BindWidget))
	TObjectPtr<UButton> CloseButton = nullptr;

	UPROPERTY(meta = (BindWidget))
	TObjectPtr<UButton> MinimizeButton = nullptr;

	UPROPERTY(meta = (BindWidget))
	TObjectPtr<UButton> MaximizeButton = nullptr;

	UPROPERTY(meta = (BindWidget))
	TObjectPtr<UNamedSlot> ContentSlot = nullptr;
};

UCLASS(BlueprintType)
class BLUEPRINTEXTRACTORFIXTURE_API UBlueprintExtractorFixtureRenameBindWidgetParent : public UUserWidget
{
	GENERATED_BODY()

protected:
	UPROPERTY(meta = (BindWidget))
	TObjectPtr<UImage> ShortcutIcon = nullptr;
};

UCLASS(BlueprintType)
class BLUEPRINTEXTRACTORFIXTURE_API UBlueprintExtractorFixtureStyledWidgetParent : public UUserWidget
{
	GENERATED_BODY()

public:
	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Fixture")
	TObjectPtr<UMaterialInterface> ActiveTitleBarMaterial = nullptr;

	UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "Fixture")
	TObjectPtr<UMaterialInterface> InactiveTitleBarMaterial = nullptr;

protected:
	UPROPERTY(meta = (BindWidget))
	TObjectPtr<UImage> TitleBarBg = nullptr;

	UPROPERTY(meta = (BindWidget))
	TObjectPtr<UTextBlock> TitleText = nullptr;
};
