using UnrealBuildTool;

public class BlueprintExtractor : ModuleRules
{
	public BlueprintExtractor(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;

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
			"Json",
			"JsonUtilities",
			"InputCore",
			"AIModule",
			"MaterialEditor",
			"PropertyBindingUtils",
			"StateTreeModule",
			"StructUtils",
			"GameplayTags",
			"UMG",
			"UMGEditor"
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
