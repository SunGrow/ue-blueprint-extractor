#pragma once

#include "CoreMinimal.h"

class FJsonObject;
class UWidgetBlueprint;

struct FBlueprintExtractorCaptureMetadata
{
	FString CaptureId;
	FString CaptureType;
	FString AssetPath;
	FString WidgetClass;
	FString CaptureDirectory;
	FString ArtifactPath;
	FString MetadataPath;
	int32 Width = 0;
	int32 Height = 0;
	int64 FileSizeBytes = 0;
	FString CreatedAt;
	FString ProjectDir;
};

struct FBlueprintExtractorCaptureCompareResult
{
	FString CapturePath;
	FString ReferencePath;
	double Tolerance = 0.0;
	bool bPass = false;
	double Rmse = 0.0;
	int32 MaxPixelDelta = 0;
	int64 MismatchPixelCount = 0;
	double MismatchPercentage = 0.0;
	FString DiffCaptureId;
	FString DiffArtifactPath;
};

namespace BlueprintExtractorCapture
{
	bool CaptureWidgetPreview(UWidgetBlueprint* WidgetBlueprint,
		int32 RequestedWidth,
		int32 RequestedHeight,
		FBlueprintExtractorCaptureMetadata& OutMetadata,
		FString& OutError);

	bool CompareCaptureToReference(const FString& CaptureIdOrPath,
		const FString& ReferenceIdOrPath,
		double Tolerance,
		FBlueprintExtractorCaptureCompareResult& OutResult,
		FString& OutError);

	bool ListCaptures(const FString& AssetPathFilter,
		TArray<FBlueprintExtractorCaptureMetadata>& OutCaptures,
		FString& OutError);

	bool CleanupCaptures(int32 MaxAgeDays,
		int32& OutDeletedCount,
		int64& OutFreedBytes,
		FString& OutError);

	TSharedPtr<FJsonObject> CaptureMetadataToJson(const FBlueprintExtractorCaptureMetadata& Metadata);
	TSharedPtr<FJsonObject> CaptureCompareResultToJson(const FBlueprintExtractorCaptureCompareResult& Result);
}
