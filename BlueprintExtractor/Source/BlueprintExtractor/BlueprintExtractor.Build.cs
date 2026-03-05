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
			"Json",
			"JsonUtilities",
			"InputCore",
			"StateTreeModule",
			"StructUtils",
			"GameplayTags"
		});

		if (Target.bBuildEditor)
		{
			PrivateDependencyModuleNames.Add("StateTreeEditorModule");
		}
	}
}
