#include "BlueprintExtractorSettings.h"

#define LOCTEXT_NAMESPACE "BlueprintExtractorSettings"

UBlueprintExtractorSettings::UBlueprintExtractorSettings()
{
	OutputDirectory.Path = TEXT("BlueprintExtractor");
}

const UBlueprintExtractorSettings* UBlueprintExtractorSettings::Get()
{
	return GetDefault<UBlueprintExtractorSettings>();
}

FText UBlueprintExtractorSettings::GetSectionText() const
{
	return LOCTEXT("SectionText", "Blueprint Extractor");
}

#undef LOCTEXT_NAMESPACE
