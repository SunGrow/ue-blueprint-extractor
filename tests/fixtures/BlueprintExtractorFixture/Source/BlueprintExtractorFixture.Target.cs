using UnrealBuildTool;
using System.Collections.Generic;
using System;

public class BlueprintExtractorFixtureTarget : TargetRules
{
	public BlueprintExtractorFixtureTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = Enum.TryParse<BuildSettingsVersion>("V6", out var BuildSettingsV6)
			? BuildSettingsV6
			: BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.AddRange(new List<string>
		{
			"BlueprintExtractorFixture"
		});
	}
}
