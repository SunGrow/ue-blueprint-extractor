using UnrealBuildTool;

public class BlueprintExtractorFixture : ModuleRules
{
	public BlueprintExtractorFixture(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"Slate",
			"SlateCore",
			"UMG"
		});
	}
}
