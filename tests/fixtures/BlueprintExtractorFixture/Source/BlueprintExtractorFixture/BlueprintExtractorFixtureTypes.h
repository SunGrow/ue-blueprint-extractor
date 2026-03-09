#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "Engine/DataAsset.h"
#include "Engine/DataTable.h"

#include "BlueprintExtractorFixtureTypes.generated.h"

class UButton;
class UImage;
class UNamedSlot;
class UTextBlock;
class UWidget;

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
