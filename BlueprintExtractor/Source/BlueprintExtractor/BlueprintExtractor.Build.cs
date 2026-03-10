using UnrealBuildTool;

public class BlueprintExtractor : ModuleRules
{
	public BlueprintExtractor(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;
		ShortName = "BPE";

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core"
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"CoreUObject",
			"EditorSubsystem",
			"Engine",
			"DeveloperSettings",
			"Slate",
			"SlateCore",
			"UnrealEd",
			"BlueprintGraph",
			"KismetCompiler",
			"Kismet",
			"GraphEditor",
			"ContentBrowser",
			"ContentBrowserData",
			"AssetTools",
			"AssetRegistry",
			"HTTP",
			"InterchangeEngine",
			"Json",
			"JsonUtilities",
			"InputCore",
			"AIModule",
			"MaterialEditor",
			"PropertyBindingUtils",
			"StateTreeModule",
			"GameplayTags",
			"UMG",
			"UMGEditor",
			"SparseVolumeTexture"
		});

		if (Target.bBuildEditor)
		{
			PrivateDependencyModuleNames.AddRange(new string[]
			{
				"AIGraph",
				"AnimationBlueprintLibrary",
				"BehaviorTreeEditor",
				"StateTreeEditorModule"
			});
		}
	}
}
