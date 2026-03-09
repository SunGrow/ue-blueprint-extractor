#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "Engine/DataTable.h"

#include "BlueprintExtractorFixtureTypes.generated.h"

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
