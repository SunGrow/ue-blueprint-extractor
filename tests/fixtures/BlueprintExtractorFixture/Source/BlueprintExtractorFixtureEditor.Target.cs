using UnrealBuildTool;
using System.Collections.Generic;

public class BlueprintExtractorFixtureEditorTarget : TargetRules
{
	public BlueprintExtractorFixtureEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.AddRange(new List<string>
		{
			"BlueprintExtractorFixture"
		});
	}
}
