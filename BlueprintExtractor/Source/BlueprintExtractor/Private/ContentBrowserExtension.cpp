#include "ContentBrowserExtension.h"
#include "BlueprintExtractorModule.h"
#include "BlueprintExtractorLibrary.h"
#include "BlueprintExtractorSettings.h"
#include "ContentBrowserModule.h"
#include "ContentBrowserDelegates.h"
#include "Engine/Blueprint.h"
#include "Engine/DataAsset.h"
#include "Engine/DataTable.h"
#include "StateTree.h"
#include "Framework/MultiBox/MultiBoxBuilder.h"
#include "Misc/FileHelper.h"
#include "Misc/ScopedSlowTask.h"

#define LOCTEXT_NAMESPACE "BlueprintExtractor"

static void ExecuteExtraction(TArray<FAssetData> SelectedAssets)
{
	const UBlueprintExtractorSettings* Settings = UBlueprintExtractorSettings::Get();
	const EBlueprintExtractionScope Scope = Settings->bIncludeBytecode
		? EBlueprintExtractionScope::FullWithBytecode
		: Settings->DefaultScope;

	FString OutputDir = Settings->OutputDirectory.Path;
	if (OutputDir.IsEmpty())
	{
		OutputDir = FPaths::ProjectSavedDir() / TEXT("BlueprintExtractor");
	}
	else if (FPaths::IsRelative(OutputDir))
	{
		OutputDir = FPaths::ProjectContentDir() / OutputDir;
	}

	IFileManager::Get().MakeDirectory(*OutputDir, true);

	// Load all selected assets
	TArray<UObject*> Assets;
	for (const FAssetData& AssetData : SelectedAssets)
	{
		UObject* Asset = AssetData.GetAsset();
		if (Asset)
		{
			Assets.Add(Asset);
		}
	}

	if (Settings->bEnableCascadeExtraction)
	{
		FScopedSlowTask SlowTask(0, LOCTEXT("ExtractingCascade", "Extracting with cascade (following references)..."));
		SlowTask.MakeDialog();

		int32 SuccessCount = UBlueprintExtractorLibrary::ExtractWithCascade(Assets, OutputDir, Scope, Settings->MaxCascadeDepth);
		UE_LOG(LogBlueprintExtractor, Log, TEXT("Cascade extraction complete: %d total assets extracted to %s"), SuccessCount, *OutputDir);
	}
	else
	{
		FScopedSlowTask SlowTask(SelectedAssets.Num(), LOCTEXT("ExtractingBlueprints", "Extracting Blueprints to JSON..."));
		SlowTask.MakeDialog();

		int32 SuccessCount = 0;
		for (const FAssetData& AssetData : SelectedAssets)
		{
			SlowTask.EnterProgressFrame(1.f, FText::FromString(AssetData.AssetName.ToString()));

			UObject* Asset = AssetData.GetAsset();
			if (!Asset)
			{
				continue;
			}

			const FString FileName = Asset->GetName() + TEXT(".json");
			const FString FullPath = OutputDir / FileName;

			if (UBlueprint* Blueprint = Cast<UBlueprint>(Asset))
			{
				if (UBlueprintExtractorLibrary::ExtractBlueprintToJson(Blueprint, FullPath, Scope))
				{
					SuccessCount++;
				}
			}
			else if (UStateTree* StateTree = Cast<UStateTree>(Asset))
			{
				if (UBlueprintExtractorLibrary::ExtractStateTreeToJson(StateTree, FullPath))
				{
					SuccessCount++;
				}
			}
			else if (UDataAsset* DataAsset = Cast<UDataAsset>(Asset))
			{
				if (UBlueprintExtractorLibrary::ExtractDataAssetToJson(DataAsset, FullPath))
				{
					SuccessCount++;
				}
			}
			else if (UDataTable* DataTable = Cast<UDataTable>(Asset))
			{
				if (UBlueprintExtractorLibrary::ExtractDataTableToJson(DataTable, FullPath))
				{
					SuccessCount++;
				}
			}
		}

		UE_LOG(LogBlueprintExtractor, Log, TEXT("Extracted %d/%d assets to %s"), SuccessCount, SelectedAssets.Num(), *OutputDir);
	}
}

static TSharedRef<FExtender> OnExtendContentBrowserAssetSelectionMenu(const TArray<FAssetData>& SelectedAssets)
{
	TSharedRef<FExtender> Extender = MakeShared<FExtender>();

	bool bHasExtractable = false;
	for (const FAssetData& Asset : SelectedAssets)
	{
		const FString ClassName = Asset.AssetClassPath.GetAssetName().ToString();
		if (ClassName.Contains(TEXT("Blueprint")) || ClassName == TEXT("StateTree") || ClassName == TEXT("DataTable") || ClassName.Contains(TEXT("DataAsset")))
		{
			bHasExtractable = true;
			break;
		}
	}

	if (bHasExtractable)
	{
		Extender->AddMenuExtension(
			"GetAssetActions",
			EExtensionHook::After,
			nullptr,
			FMenuExtensionDelegate::CreateLambda([SelectedAssets](FMenuBuilder& MenuBuilder)
			{
				MenuBuilder.AddMenuEntry(
					LOCTEXT("ExtractToJson", "Extract to JSON"),
					LOCTEXT("ExtractToJsonTooltip", "Extract Blueprint or StateTree data to structured JSON file"),
					FSlateIcon(),
					FUIAction(FExecuteAction::CreateLambda([&SelectedAssets]()
					{
						ExecuteExtraction(SelectedAssets);
					}))
				);
			})
		);
	}

	return Extender;
}

void FContentBrowserExtension::RegisterMenuExtension(FDelegateHandle& OutHandle)
{
	FContentBrowserModule& ContentBrowserModule = FModuleManager::LoadModuleChecked<FContentBrowserModule>(TEXT("ContentBrowser"));

	TArray<FContentBrowserMenuExtender_SelectedAssets>& MenuExtenders = ContentBrowserModule.GetAllAssetViewContextMenuExtenders();

	MenuExtenders.Add(FContentBrowserMenuExtender_SelectedAssets::CreateStatic(&OnExtendContentBrowserAssetSelectionMenu));
	OutHandle = MenuExtenders.Last().GetHandle();
}

void FContentBrowserExtension::UnregisterMenuExtension(FDelegateHandle& InHandle)
{
	if (!FModuleManager::Get().IsModuleLoaded(TEXT("ContentBrowser")))
	{
		return;
	}

	FContentBrowserModule& ContentBrowserModule = FModuleManager::GetModuleChecked<FContentBrowserModule>(TEXT("ContentBrowser"));

	TArray<FContentBrowserMenuExtender_SelectedAssets>& MenuExtenders = ContentBrowserModule.GetAllAssetViewContextMenuExtenders();
	MenuExtenders.RemoveAll([&InHandle](const FContentBrowserMenuExtender_SelectedAssets& Delegate)
	{
		return Delegate.GetHandle() == InHandle;
	});
}

#undef LOCTEXT_NAMESPACE
