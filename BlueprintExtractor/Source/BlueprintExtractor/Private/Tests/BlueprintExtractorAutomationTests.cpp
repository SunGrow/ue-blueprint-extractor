#if WITH_DEV_AUTOMATION_TESTS

#include "BlueprintExtractorSubsystem.h"

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Editor.h"
#include "Misc/AutomationTest.h"
#include "Misc/Guid.h"
#include "Misc/PackageName.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

namespace BlueprintExtractorAutomation
{

static constexpr TCHAR ScratchRoot[] = TEXT("/Game/__GeneratedTests__");
static constexpr TCHAR DefaultMaterialPath[] = TEXT("/Engine/EngineMaterials/DefaultMaterial.DefaultMaterial");
static constexpr TCHAR EngineSkeletonPath[] = TEXT("/Engine/EngineMeshes/SkeletalCube_Skeleton.SkeletalCube_Skeleton");
static constexpr TCHAR EnginePreviewMeshPath[] = TEXT("/Engine/EngineMeshes/SkeletalCube.SkeletalCube");
static constexpr TCHAR StateTreeSchemaPath[] = TEXT("/Script/GameplayStateTreeModule.StateTreeComponentSchema");
static constexpr TCHAR FixtureDataAssetClassPath[] = TEXT("/Script/BlueprintExtractorFixture.BlueprintExtractorFixtureDataAsset");
static constexpr TCHAR FixtureRowStructPath[] = TEXT("/Script/BlueprintExtractorFixture.BlueprintExtractorFixtureRow");

static FString MakeUniqueAssetPath(const FString& Prefix)
{
	return FString::Printf(
		TEXT("%s/%s_%s"),
		ScratchRoot,
		*Prefix,
		*FGuid::NewGuid().ToString(EGuidFormats::Digits));
}

static FString MakeObjectPath(const FString& AssetPath)
{
	return FString::Printf(
		TEXT("%s.%s"),
		*AssetPath,
		*FPackageName::GetLongPackageAssetName(AssetPath));
}

static FString MakePackageFilename(const FString& AssetPath)
{
	return FPackageName::LongPackageNameToFilename(
		AssetPath,
		FPackageName::GetAssetPackageExtension());
}

static FString SerializeStringArray(const TArray<FString>& Values)
{
	TArray<TSharedPtr<FJsonValue>> JsonValues;
	for (const FString& Value : Values)
	{
		JsonValues.Add(MakeShared<FJsonValueString>(Value));
	}

	FString Output;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Output);
	FJsonSerializer::Serialize(JsonValues, Writer);
	return Output;
}

static TSharedPtr<FJsonObject> ParseJsonObject(FAutomationTestBase& Test,
                                               const FString& RawJson,
                                               const FString& Context)
{
	TSharedPtr<FJsonObject> Parsed;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(RawJson);
	Test.TestTrue(*FString::Printf(TEXT("%s returns valid JSON"), *Context), FJsonSerializer::Deserialize(Reader, Parsed) && Parsed.IsValid());
	return Parsed;
}

static bool HasErrorField(const TSharedPtr<FJsonObject>& Parsed)
{
	FString Error;
	return Parsed.IsValid() && Parsed->TryGetStringField(TEXT("error"), Error) && !Error.IsEmpty();
}

static bool IsFailureResult(const TSharedPtr<FJsonObject>& Parsed)
{
	if (!Parsed.IsValid())
	{
		return false;
	}

	if (HasErrorField(Parsed))
	{
		return true;
	}

	return Parsed->HasTypedField<EJson::Boolean>(TEXT("success"))
		&& !Parsed->GetBoolField(TEXT("success"));
}

static TSharedPtr<FJsonObject> ExpectSuccessfulResult(FAutomationTestBase& Test,
                                                      const FString& RawJson,
                                                      const FString& Context)
{
	const TSharedPtr<FJsonObject> Parsed = ParseJsonObject(Test, RawJson, Context);
	if (!Parsed.IsValid())
	{
		return nullptr;
	}

	FString Error;
	const bool bHasError = Parsed->TryGetStringField(TEXT("error"), Error) && !Error.IsEmpty();
	Test.TestFalse(*FString::Printf(TEXT("%s has no error payload"), *Context), bHasError);

	bool bSuccess = true;
	if (Parsed->HasTypedField<EJson::Boolean>(TEXT("success")))
	{
		bSuccess = Parsed->GetBoolField(TEXT("success"));
	}
	Test.TestTrue(*FString::Printf(TEXT("%s succeeded"), *Context), bSuccess);
	return Parsed;
}

static bool ExpectValidateOnlyResult(FAutomationTestBase& Test,
                                     const FString& RawJson,
                                     const FString& Context)
{
	const TSharedPtr<FJsonObject> Parsed = ExpectSuccessfulResult(Test, RawJson, Context);
	if (!Parsed.IsValid())
	{
		return false;
	}

	if (Parsed->HasTypedField<EJson::Boolean>(TEXT("validateOnly")))
	{
		Test.TestTrue(*FString::Printf(TEXT("%s sets validateOnly"), *Context), Parsed->GetBoolField(TEXT("validateOnly")));
	}

	const TArray<TSharedPtr<FJsonValue>>* DirtyPackages = nullptr;
	if (Parsed->TryGetArrayField(TEXT("dirtyPackages"), DirtyPackages) && DirtyPackages)
	{
		Test.TestEqual(*FString::Printf(TEXT("%s leaves no dirty packages"), *Context), DirtyPackages->Num(), 0);
	}

	return true;
}

static UBlueprintExtractorSubsystem* GetSubsystem(FAutomationTestBase& Test)
{
	Test.TestNotNull(TEXT("GEditor is available"), GEditor);
	return GEditor ? GEditor->GetEditorSubsystem<UBlueprintExtractorSubsystem>() : nullptr;
}

static bool RunValidateOnlyCoverage(FAutomationTestBase& Test)
{
	UBlueprintExtractorSubsystem* Subsystem = GetSubsystem(Test);
	if (!Subsystem)
	{
		return false;
	}

	ExpectValidateOnlyResult(
		Test,
		Subsystem->CreateBlueprint(
			MakeUniqueAssetPath(TEXT("BP_Validate")),
			TEXT("/Script/Engine.Actor"),
			TEXT("{}"),
			true),
		TEXT("CreateBlueprint validate_only"));

	ExpectValidateOnlyResult(
		Test,
		Subsystem->CreateDataAsset(
			MakeUniqueAssetPath(TEXT("DA_Validate")),
			FixtureDataAssetClassPath,
			TEXT(R"json({"Count":3})json"),
			true),
		TEXT("CreateDataAsset validate_only"));

	ExpectValidateOnlyResult(
		Test,
		Subsystem->CreateDataTable(
			MakeUniqueAssetPath(TEXT("DT_Validate")),
			FixtureRowStructPath,
			TEXT(R"json([{"rowName":"Default","values":{"Count":1}}])json"),
			true),
		TEXT("CreateDataTable validate_only"));

	ExpectValidateOnlyResult(
		Test,
		Subsystem->CreateCurve(
			MakeUniqueAssetPath(TEXT("C_Validate")),
			TEXT("Float"),
			TEXT("{}"),
			true),
		TEXT("CreateCurve validate_only"));

	ExpectValidateOnlyResult(
		Test,
		Subsystem->CreateCurveTable(
			MakeUniqueAssetPath(TEXT("CT_Validate")),
			TEXT("SimpleCurves"),
			TEXT("[]"),
			true),
		TEXT("CreateCurveTable validate_only"));

	ExpectValidateOnlyResult(
		Test,
		Subsystem->CreateMaterialInstance(
			MakeUniqueAssetPath(TEXT("MI_Validate")),
			DefaultMaterialPath,
			true),
		TEXT("CreateMaterialInstance validate_only"));

	ExpectValidateOnlyResult(
		Test,
		Subsystem->CreateUserDefinedStruct(
			MakeUniqueAssetPath(TEXT("S_Validate")),
			TEXT(R"json({"fields":[{"name":"Count","pinType":{"category":"int"}}]})json"),
			true),
		TEXT("CreateUserDefinedStruct validate_only"));

	ExpectValidateOnlyResult(
		Test,
		Subsystem->CreateUserDefinedEnum(
			MakeUniqueAssetPath(TEXT("E_Validate")),
			TEXT(R"json({"entries":[{"name":"Alpha"},{"name":"Beta"}]})json"),
			true),
		TEXT("CreateUserDefinedEnum validate_only"));

	ExpectValidateOnlyResult(
		Test,
		Subsystem->CreateBlackboard(
			MakeUniqueAssetPath(TEXT("BB_Validate")),
			TEXT(R"json({"keys":[{"entryName":"TargetActor","keyTypePath":"/Script/AIModule.BlackboardKeyType_Object","baseClass":"/Script/Engine.Actor"}]})json"),
			true),
		TEXT("CreateBlackboard validate_only"));

	ExpectValidateOnlyResult(
		Test,
		Subsystem->CreateBehaviorTree(
			MakeUniqueAssetPath(TEXT("BT_Validate")),
			TEXT("{}"),
			true),
		TEXT("CreateBehaviorTree validate_only"));

	ExpectValidateOnlyResult(
		Test,
		Subsystem->CreateStateTree(
			MakeUniqueAssetPath(TEXT("ST_Validate")),
			FString::Printf(TEXT(R"json({"schemaClassPath":"%s"})json"), StateTreeSchemaPath),
			true),
		TEXT("CreateStateTree validate_only"));

	ExpectValidateOnlyResult(
		Test,
		Subsystem->CreateAnimSequence(
			MakeUniqueAssetPath(TEXT("AS_Validate")),
			FString::Printf(TEXT(R"json({"skeleton":"%s","previewMesh":"%s"})json"), EngineSkeletonPath, EnginePreviewMeshPath),
			true),
		TEXT("CreateAnimSequence validate_only"));

	ExpectValidateOnlyResult(
		Test,
		Subsystem->CreateAnimMontage(
			MakeUniqueAssetPath(TEXT("AM_Validate")),
			FString::Printf(TEXT(R"json({"skeleton":"%s","previewMesh":"%s"})json"), EngineSkeletonPath, EnginePreviewMeshPath),
			true),
		TEXT("CreateAnimMontage validate_only"));

	ExpectValidateOnlyResult(
		Test,
		Subsystem->CreateBlendSpace(
			MakeUniqueAssetPath(TEXT("BS_Validate")),
			FString::Printf(TEXT(R"json({"skeleton":"%s","previewMesh":"%s","is1D":true,"axisX":{"name":"Speed","min":0.0,"max":600.0,"gridDivisions":4}})json"), EngineSkeletonPath, EnginePreviewMeshPath),
			true),
		TEXT("CreateBlendSpace validate_only"));

	return true;
}

static bool RunRoundTripCoverage(FAutomationTestBase& Test)
{
	UBlueprintExtractorSubsystem* Subsystem = GetSubsystem(Test);
	if (!Subsystem)
	{
		return false;
	}

	const FString BlueprintAssetPath = MakeUniqueAssetPath(TEXT("BP_Smoke"));
	const FString WidgetAssetPath = MakeUniqueAssetPath(TEXT("WBP_Smoke"));
	const FString DataAssetPath = MakeUniqueAssetPath(TEXT("DA_Smoke"));
	const FString StructAssetPath = MakeUniqueAssetPath(TEXT("S_Smoke"));
	const FString EnumAssetPath = MakeUniqueAssetPath(TEXT("E_Smoke"));
	const FString DataTableAssetPath = MakeUniqueAssetPath(TEXT("DT_Smoke"));
	const FString CurveAssetPath = MakeUniqueAssetPath(TEXT("C_Smoke"));
	const FString CurveTableAssetPath = MakeUniqueAssetPath(TEXT("CT_Smoke"));
	const FString MaterialInstanceAssetPath = MakeUniqueAssetPath(TEXT("MI_Smoke"));
	const FString BlackboardAssetPath = MakeUniqueAssetPath(TEXT("BB_Smoke"));
	const FString BehaviorTreeAssetPath = MakeUniqueAssetPath(TEXT("BT_Smoke"));
	const FString StateTreeAssetPath = MakeUniqueAssetPath(TEXT("ST_Smoke"));
	const FString AnimSequenceAssetPath = MakeUniqueAssetPath(TEXT("AS_Smoke"));
	const FString AnimMontageAssetPath = MakeUniqueAssetPath(TEXT("AM_Smoke"));
	const FString BlendSpaceAssetPath = MakeUniqueAssetPath(TEXT("BS_Smoke"));
	const FString BlueprintObjectPath = MakeObjectPath(BlueprintAssetPath);
	const FString WidgetObjectPath = MakeObjectPath(WidgetAssetPath);
	const FString DataAssetObjectPath = MakeObjectPath(DataAssetPath);
	const FString StructObjectPath = MakeObjectPath(StructAssetPath);
	const FString EnumObjectPath = MakeObjectPath(EnumAssetPath);
	const FString DataTableObjectPath = MakeObjectPath(DataTableAssetPath);
	const FString CurveObjectPath = MakeObjectPath(CurveAssetPath);
	const FString CurveTableObjectPath = MakeObjectPath(CurveTableAssetPath);
	const FString MaterialInstanceObjectPath = MakeObjectPath(MaterialInstanceAssetPath);
	const FString BlackboardObjectPath = MakeObjectPath(BlackboardAssetPath);
	const FString BehaviorTreeObjectPath = MakeObjectPath(BehaviorTreeAssetPath);
	const FString StateTreeObjectPath = MakeObjectPath(StateTreeAssetPath);
	const FString AnimSequenceObjectPath = MakeObjectPath(AnimSequenceAssetPath);
	const FString AnimMontageObjectPath = MakeObjectPath(AnimMontageAssetPath);
	const FString BlendSpaceObjectPath = MakeObjectPath(BlendSpaceAssetPath);

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateBlueprint(
			BlueprintAssetPath,
			TEXT("/Script/Engine.Actor"),
			TEXT("{}"),
			false),
		TEXT("CreateBlueprint"));

	Test.TestFalse(TEXT("Blueprint .uasset file is not written before SaveAssets"), FPaths::FileExists(MakePackageFilename(BlueprintAssetPath)));

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateWidgetBlueprint(
			WidgetAssetPath,
			TEXT("UserWidget")),
		TEXT("CreateWidgetBlueprint"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->BuildWidgetTree(
			WidgetObjectPath,
			TEXT(R"json({"class":"CanvasPanel","name":"RootCanvas","is_variable":true,"children":[{"class":"TextBlock","name":"TitleText","is_variable":true}]})json"),
			false),
		TEXT("BuildWidgetTree"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ModifyWidget(
			WidgetObjectPath,
			TEXT("TitleText"),
			TEXT(R"json({"RenderOpacity":0.5})json"),
			TEXT("{}"),
			false),
		TEXT("ModifyWidget"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->CompileWidgetBlueprint(WidgetObjectPath),
		TEXT("CompileWidgetBlueprint"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateDataAsset(
			DataAssetPath,
			FixtureDataAssetClassPath,
			TEXT(R"json({"Count":7})json"),
			false),
		TEXT("CreateDataAsset"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ModifyDataAsset(
			DataAssetObjectPath,
			TEXT(R"json({"Count":8})json"),
			false),
		TEXT("ModifyDataAsset"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateUserDefinedStruct(
			StructAssetPath,
			TEXT(R"json({"fields":[{"name":"Count","pinType":{"category":"int"}}]})json"),
			false),
		TEXT("CreateUserDefinedStruct"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateUserDefinedEnum(
			EnumAssetPath,
			TEXT(R"json({"entries":[{"name":"Alpha"},{"name":"Beta"}]})json"),
			false),
		TEXT("CreateUserDefinedEnum"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateDataTable(
			DataTableAssetPath,
			FixtureRowStructPath,
			TEXT(R"json([{"rowName":"Default","values":{"Count":1}}])json"),
			false),
		TEXT("CreateDataTable"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ModifyDataTable(
			DataTableObjectPath,
			TEXT(R"json({"rows":[{"rowName":"Default","values":{"Count":2}}]})json"),
			false),
		TEXT("ModifyDataTable"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateCurve(
			CurveAssetPath,
			TEXT("Float"),
			TEXT(R"json({"default":{"keys":[{"time":0.0,"value":0.0},{"time":1.0,"value":1.0}]}})json"),
			false),
		TEXT("CreateCurve"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateCurveTable(
			CurveTableAssetPath,
			TEXT("SimpleCurves"),
			TEXT(R"json([{"rowName":"CurveA","curve":{"keys":[{"time":0.0,"value":0.0},{"time":1.0,"value":1.0}]}}])json"),
			false),
		TEXT("CreateCurveTable"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateMaterialInstance(
			MaterialInstanceAssetPath,
			DefaultMaterialPath,
			false),
		TEXT("CreateMaterialInstance"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateBlackboard(
			BlackboardAssetPath,
			TEXT(R"json({"keys":[{"entryName":"TargetActor","keyTypePath":"/Script/AIModule.BlackboardKeyType_Object","baseClass":"/Script/Engine.Actor"}]})json"),
			false),
		TEXT("CreateBlackboard"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateBehaviorTree(
			BehaviorTreeAssetPath,
			FString::Printf(TEXT(R"json({"blackboardAsset":"%s"})json"), *BlackboardObjectPath),
			false),
		TEXT("CreateBehaviorTree"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ModifyBlackboard(
			BlackboardObjectPath,
			TEXT("patch_key"),
			TEXT(R"json({"entryName":"TargetActor","isInstanceSynced":true})json"),
			false),
		TEXT("ModifyBlackboard patch_key"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ModifyBehaviorTree(
			BehaviorTreeObjectPath,
			TEXT("replace_tree"),
			TEXT("{}"),
			false),
		TEXT("ModifyBehaviorTree replace_tree"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateStateTree(
			StateTreeAssetPath,
			FString::Printf(TEXT(R"json({"schemaClassPath":"%s"})json"), StateTreeSchemaPath),
			false),
		TEXT("CreateStateTree"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ModifyStateTree(
			StateTreeObjectPath,
			TEXT("set_schema"),
			FString::Printf(TEXT(R"json({"schemaClassPath":"%s"})json"), StateTreeSchemaPath),
			false),
		TEXT("ModifyStateTree set_schema"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateAnimSequence(
			AnimSequenceAssetPath,
			FString::Printf(TEXT(R"json({"skeleton":"%s","previewMesh":"%s"})json"), EngineSkeletonPath, EnginePreviewMeshPath),
			false),
		TEXT("CreateAnimSequence"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ModifyAnimSequence(
			AnimSequenceObjectPath,
			TEXT("replace_notifies"),
			TEXT(R"json({"notifies":[]})json"),
			false),
		TEXT("ModifyAnimSequence replace_notifies"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateAnimMontage(
			AnimMontageAssetPath,
			FString::Printf(TEXT(R"json({"skeleton":"%s","previewMesh":"%s"})json"), EngineSkeletonPath, EnginePreviewMeshPath),
			false),
		TEXT("CreateAnimMontage"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ModifyAnimMontage(
			AnimMontageObjectPath,
			TEXT("replace_notifies"),
			TEXT(R"json({"notifies":[]})json"),
			false),
		TEXT("ModifyAnimMontage replace_notifies"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateBlendSpace(
			BlendSpaceAssetPath,
			FString::Printf(TEXT(R"json({"skeleton":"%s","previewMesh":"%s","is1D":true,"axisX":{"name":"Speed","min":0.0,"max":600.0,"gridDivisions":4}})json"), EngineSkeletonPath, EnginePreviewMeshPath),
			false),
		TEXT("CreateBlendSpace"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ModifyBlendSpace(
			BlendSpaceObjectPath,
			TEXT("set_axes"),
			TEXT(R"json({"axisX":{}})json"),
			false),
		TEXT("ModifyBlendSpace set_axes"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->ModifyBlueprintMembers(
			BlueprintObjectPath,
			TEXT("replace_variables"),
			TEXT(R"json({"variables":[{"name":"Count","pinType":{"category":"int"},"defaultValue":"5"}]})json"),
			false),
		TEXT("ModifyBlueprintMembers replace_variables"));

	const TArray<FString> AssetsToSave = {
		BlueprintObjectPath,
		WidgetObjectPath,
		DataAssetObjectPath,
		StructObjectPath,
		EnumObjectPath,
		DataTableObjectPath,
		CurveObjectPath,
		CurveTableObjectPath,
		MaterialInstanceObjectPath,
		BlackboardObjectPath,
		BehaviorTreeObjectPath,
		StateTreeObjectPath,
		AnimSequenceObjectPath,
		AnimMontageObjectPath,
		BlendSpaceObjectPath,
	};
	const TSharedPtr<FJsonObject> SaveResult = ExpectSuccessfulResult(
		Test,
		Subsystem->SaveAssets(SerializeStringArray(AssetsToSave)),
		TEXT("SaveAssets"));
	if (SaveResult.IsValid() && SaveResult->HasTypedField<EJson::Boolean>(TEXT("saved")))
	{
		Test.TestTrue(TEXT("SaveAssets reports saved=true"), SaveResult->GetBoolField(TEXT("saved")));
	}

	Test.TestTrue(TEXT("Blueprint .uasset file exists after SaveAssets"), FPaths::FileExists(MakePackageFilename(BlueprintAssetPath)));

	ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractBlueprint(BlueprintObjectPath, TEXT("Variables"), TEXT("")),
		TEXT("ExtractBlueprint"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractBlueprint(WidgetObjectPath, TEXT("Components"), TEXT("")),
		TEXT("ExtractWidgetBlueprint as Blueprint"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractDataAsset(DataAssetObjectPath),
		TEXT("ExtractDataAsset"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractUserDefinedStruct(StructObjectPath),
		TEXT("ExtractUserDefinedStruct"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractUserDefinedEnum(EnumObjectPath),
		TEXT("ExtractUserDefinedEnum"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractDataTable(DataTableObjectPath),
		TEXT("ExtractDataTable"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractCurve(CurveObjectPath),
		TEXT("ExtractCurve"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractCurveTable(CurveTableObjectPath),
		TEXT("ExtractCurveTable"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractMaterialInstance(MaterialInstanceObjectPath),
		TEXT("ExtractMaterialInstance"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractBlackboard(BlackboardObjectPath),
		TEXT("ExtractBlackboard"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractBehaviorTree(BehaviorTreeObjectPath),
		TEXT("ExtractBehaviorTree"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractStateTree(StateTreeObjectPath),
		TEXT("ExtractStateTree"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractAnimSequence(AnimSequenceObjectPath),
		TEXT("ExtractAnimSequence"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractAnimMontage(AnimMontageObjectPath),
		TEXT("ExtractAnimMontage"));
	ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractBlendSpace(BlendSpaceObjectPath),
		TEXT("ExtractBlendSpace"));

	const TSharedPtr<FJsonObject> DuplicateBlueprintResult = ParseJsonObject(
		Test,
		Subsystem->CreateBlueprint(
			BlueprintAssetPath,
			TEXT("/Script/Engine.Actor"),
			TEXT("{}"),
			false),
		TEXT("Duplicate CreateBlueprint"));
	Test.TestTrue(TEXT("Duplicate CreateBlueprint is rejected"), IsFailureResult(DuplicateBlueprintResult));

	return true;
}

static bool RunMissingAssetCoverage(FAutomationTestBase& Test)
{
	UBlueprintExtractorSubsystem* Subsystem = GetSubsystem(Test);
	if (!Subsystem)
	{
		return false;
	}

	const FString MissingAssetPath = TEXT("/Game/__GeneratedTests__/Missing/BP_NotFound.BP_NotFound");
	const TSharedPtr<FJsonObject> ExtractBlueprintResult = ParseJsonObject(
		Test,
		Subsystem->ExtractBlueprint(MissingAssetPath, TEXT("Variables"), TEXT("")),
		TEXT("ExtractBlueprint missing asset"));
	Test.TestTrue(TEXT("ExtractBlueprint missing asset returns an error"), HasErrorField(ExtractBlueprintResult));

	const TSharedPtr<FJsonObject> SaveAssetsResult = ParseJsonObject(
		Test,
		Subsystem->SaveAssets(TEXT("[\"/Game/__GeneratedTests__/Missing/BP_NotFound.BP_NotFound\"]")),
		TEXT("SaveAssets missing asset"));
	if (SaveAssetsResult.IsValid() && SaveAssetsResult->HasTypedField<EJson::Boolean>(TEXT("success")))
	{
		Test.TestFalse(TEXT("SaveAssets missing asset reports success=false"), SaveAssetsResult->GetBoolField(TEXT("success")));
	}

	return true;
}

} // namespace BlueprintExtractorAutomation

BEGIN_DEFINE_SPEC(
	FBlueprintExtractorAutomationSpec,
	"BlueprintExtractor",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::ProductFilter)
END_DEFINE_SPEC(FBlueprintExtractorAutomationSpec)

void FBlueprintExtractorAutomationSpec::Define()
{
	using namespace BlueprintExtractorAutomation;

	Describe(TEXT("Errors"), [this]()
	{
		It(TEXT("AssetNotFound"), [this]()
		{
			TestTrue(TEXT("Missing asset coverage completes"), RunMissingAssetCoverage(*this));
		});
	});

	Describe(TEXT("Authoring"), [this]()
	{
		It(TEXT("ValidateOnly"), [this]()
		{
			TestTrue(TEXT("Validate-only coverage completes"), RunValidateOnlyCoverage(*this));
		});

		It(TEXT("RoundTrip"), [this]()
		{
			TestTrue(TEXT("Round-trip coverage completes"), RunRoundTripCoverage(*this));
		});
	});
}

#endif // WITH_DEV_AUTOMATION_TESTS
