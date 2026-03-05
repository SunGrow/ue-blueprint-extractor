#include "BlueprintExtractorModule.h"
#include "ContentBrowserExtension.h"

DEFINE_LOG_CATEGORY(LogBlueprintExtractor);

#define LOCTEXT_NAMESPACE "FBlueprintExtractorModule"

void FBlueprintExtractorModule::StartupModule()
{
	FContentBrowserExtension::RegisterMenuExtension(ContentBrowserExtenderDelegateHandle);
	UE_LOG(LogBlueprintExtractor, Log, TEXT("BlueprintExtractor module started"));
}

void FBlueprintExtractorModule::ShutdownModule()
{
	FContentBrowserExtension::UnregisterMenuExtension(ContentBrowserExtenderDelegateHandle);
}

#undef LOCTEXT_NAMESPACE

IMPLEMENT_MODULE(FBlueprintExtractorModule, BlueprintExtractor)
