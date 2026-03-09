using UnrealBuildTool;
using System.Collections.Generic;

public class BlueprintExtractorFixtureTarget : TargetRules
{
	public BlueprintExtractorFixtureTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.AddRange(new List<string>
		{
			"BlueprintExtractorFixture"
		});
	}
}
