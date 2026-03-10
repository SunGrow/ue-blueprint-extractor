#if WITH_DEV_AUTOMATION_TESTS

#include "BlueprintExtractorSubsystem.h"
#include "Authoring/AssetMutationHelpers.h"

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "EditorFramework/AssetImportData.h"
#include "Engine/StaticMesh.h"
#include "Engine/Texture.h"
#include "Editor.h"
#include "WidgetBlueprint.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Widget.h"
#include "Components/VerticalBoxSlot.h"
#include "HAL/PlatformProcess.h"
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
static constexpr TCHAR DefaultTexturePath[] = TEXT("/Engine/EngineResources/DefaultTexture.DefaultTexture");
static constexpr TCHAR EngineSkeletonPath[] = TEXT("/Engine/EngineMeshes/SkeletalCube_Skeleton.SkeletalCube_Skeleton");
static constexpr TCHAR EnginePreviewMeshPath[] = TEXT("/Engine/EngineMeshes/SkeletalCube.SkeletalCube");
static constexpr TCHAR StateTreeSchemaPath[] = TEXT("/Script/GameplayStateTreeModule.StateTreeComponentSchema");
static constexpr TCHAR FixtureDataAssetClassPath[] = TEXT("/Script/BlueprintExtractorFixture.BlueprintExtractorFixtureDataAsset");
static constexpr TCHAR FixtureRowStructPath[] = TEXT("/Script/BlueprintExtractorFixture.BlueprintExtractorFixtureRow");
static constexpr TCHAR FixtureBindWidgetParentClassPath[] = TEXT("/Script/BlueprintExtractorFixture.BlueprintExtractorFixtureBindWidgetParent");
static constexpr TCHAR FixtureRenameBindWidgetParentClassPath[] = TEXT("/Script/BlueprintExtractorFixture.BlueprintExtractorFixtureRenameBindWidgetParent");
static constexpr TCHAR TextureImportSource[] = TEXT("ImportSources/T_Test.png");
static constexpr TCHAR TextureImportSourceAlt[] = TEXT("ImportSources/T_Test_Alt.png");
static constexpr TCHAR MeshImportSource[] = TEXT("ImportSources/SM_Test.obj");

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
	if (bHasError)
	{
		Test.AddInfo(FString::Printf(TEXT("%s returned error payload: %s"), *Context, *RawJson));
	}
	Test.TestFalse(*FString::Printf(TEXT("%s has no error payload"), *Context), bHasError);

	bool bSuccess = true;
	if (Parsed->HasTypedField<EJson::Boolean>(TEXT("success")))
	{
		bSuccess = Parsed->GetBoolField(TEXT("success"));
	}
	if (!bSuccess)
	{
		Test.AddInfo(FString::Printf(TEXT("%s returned failure payload: %s"), *Context, *RawJson));
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

static TSharedPtr<FJsonObject> WaitForImportJob(FAutomationTestBase& Test,
                                                UBlueprintExtractorSubsystem* Subsystem,
                                                const FString& InitialJson,
                                                const FString& Context,
                                                FString* OutJobId = nullptr)
{
	const TSharedPtr<FJsonObject> Initial = ParseJsonObject(Test, InitialJson, Context + TEXT(" enqueue"));
	if (!Initial.IsValid())
	{
		return nullptr;
	}

	FString JobId;
	Test.TestTrue(*FString::Printf(TEXT("%s returns a jobId"), *Context), Initial->TryGetStringField(TEXT("jobId"), JobId) && !JobId.IsEmpty());
	if (OutJobId)
	{
		*OutJobId = JobId;
	}

	bool bTerminal = false;
	if (Initial->TryGetBoolField(TEXT("terminal"), bTerminal) && bTerminal)
	{
		return Initial;
	}

	for (int32 PollIndex = 0; PollIndex < 300; ++PollIndex)
	{
		FPlatformProcess::Sleep(0.1f);
		const TSharedPtr<FJsonObject> Polled = ParseJsonObject(
			Test,
			Subsystem->GetImportJob(JobId),
			Context + TEXT(" poll"));
		if (!Polled.IsValid())
		{
			return nullptr;
		}

		if (IsFailureResult(Polled))
		{
			return Polled;
		}

		if (Polled->TryGetBoolField(TEXT("terminal"), bTerminal) && bTerminal)
		{
			return Polled;
		}
	}

	Test.AddError(FString::Printf(TEXT("%s did not complete within polling window"), *Context));
	return nullptr;
}

static bool JsonArrayContainsString(const TSharedPtr<FJsonObject>& Parsed,
                                    const FString& FieldName,
                                    const FString& ExpectedValue)
{
	const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
	if (!Parsed.IsValid() || !Parsed->TryGetArrayField(FieldName, Values) || !Values)
	{
		return false;
	}

	for (const TSharedPtr<FJsonValue>& Value : *Values)
	{
		if (Value.IsValid() && Value->AsString() == ExpectedValue)
		{
			return true;
		}
	}

	return false;
}

static bool TryGetObjectFieldCopy(const TSharedPtr<FJsonObject>& Parsed,
                                  const TCHAR* FieldName,
                                  TSharedPtr<FJsonObject>& OutObject)
{
	if (!Parsed.IsValid())
	{
		return false;
	}

	const TSharedPtr<FJsonObject>* FieldObject = nullptr;
	if (Parsed->TryGetObjectField(FieldName, FieldObject) && FieldObject && FieldObject->IsValid())
	{
		OutObject = *FieldObject;
		return true;
	}

	return false;
}

static TSharedPtr<FJsonObject> FindArrayObjectByStringField(const TSharedPtr<FJsonObject>& Parsed,
                                                            const TCHAR* ArrayField,
                                                            const TCHAR* ValueField,
                                                            const FString& ExpectedValue)
{
	const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
	if (!Parsed.IsValid() || !Parsed->TryGetArrayField(ArrayField, Values) || !Values)
	{
		return nullptr;
	}

	for (const TSharedPtr<FJsonValue>& Value : *Values)
	{
		const TSharedPtr<FJsonObject> ValueObject = Value.IsValid() ? Value->AsObject() : nullptr;
		FString CandidateValue;
		if (ValueObject.IsValid() && ValueObject->TryGetStringField(ValueField, CandidateValue) && CandidateValue == ExpectedValue)
		{
			return ValueObject;
		}
	}

	return nullptr;
}

static TSharedPtr<FJsonObject> FindWidgetNodeByPath(const TSharedPtr<FJsonObject>& Node,
                                                    const FString& TargetPath,
                                                    const FString& ParentPath = FString())
{
	if (!Node.IsValid())
	{
		return nullptr;
	}

	FString NodeName;
	Node->TryGetStringField(TEXT("name"), NodeName);
	const FString NodePath = ParentPath.IsEmpty() ? NodeName : ParentPath + TEXT("/") + NodeName;
	if (NodePath == TargetPath)
	{
		return Node;
	}

	const TArray<TSharedPtr<FJsonValue>>* Children = nullptr;
	if (!Node->TryGetArrayField(TEXT("children"), Children) || !Children)
	{
		return nullptr;
	}

	for (const TSharedPtr<FJsonValue>& ChildValue : *Children)
	{
		const TSharedPtr<FJsonObject> ChildObject = ChildValue.IsValid() ? ChildValue->AsObject() : nullptr;
		if (const TSharedPtr<FJsonObject> Found = FindWidgetNodeByPath(ChildObject, TargetPath, NodePath))
		{
			return Found;
		}
	}

	return nullptr;
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
		Subsystem->CreateMaterial(
			MakeUniqueAssetPath(TEXT("M_Validate")),
			DefaultTexturePath,
			TEXT(R"json({"twoSided":true,"blendMode":"BLEND_Opaque"})json"),
			true),
		TEXT("CreateMaterial validate_only"));

	ExpectValidateOnlyResult(
		Test,
		Subsystem->CreateMaterialFunction(
			MakeUniqueAssetPath(TEXT("MF_Validate")),
			TEXT("function"),
			TEXT(R"json({"description":"Validate function"})json"),
			true),
		TEXT("CreateMaterialFunction validate_only"));

	ExpectValidateOnlyResult(
		Test,
		Subsystem->CreateMaterialFunction(
			MakeUniqueAssetPath(TEXT("MFL_Validate")),
			TEXT("layer"),
			TEXT("{}"),
			true),
		TEXT("CreateMaterialLayer validate_only"));

	ExpectValidateOnlyResult(
		Test,
		Subsystem->CreateMaterialFunction(
			MakeUniqueAssetPath(TEXT("MFLB_Validate")),
			TEXT("layer_blend"),
			TEXT("{}"),
			true),
		TEXT("CreateMaterialLayerBlend validate_only"));

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

	UWidgetBlueprint* WidgetBP = Cast<UWidgetBlueprint>(ResolveAssetByPath(WidgetObjectPath));
	Test.TestNotNull(TEXT("Widget blueprint exists after initial compile"), WidgetBP);

	const FName RootCanvasName(TEXT("RootCanvas"));
	const FName TitleTextName(TEXT("TitleText"));
	const FName BodyTextName(TEXT("BodyText"));
	FGuid RootCanvasGuid;
	if (WidgetBP)
	{
		Test.TestTrue(TEXT("Initial root widget GUID is tracked"), WidgetBP->WidgetVariableNameToGuidMap.Contains(RootCanvasName));
		Test.TestTrue(TEXT("Initial child widget GUID is tracked"), WidgetBP->WidgetVariableNameToGuidMap.Contains(TitleTextName));
		RootCanvasGuid = WidgetBP->WidgetVariableNameToGuidMap.FindRef(RootCanvasName);
		Test.TestTrue(TEXT("Initial root widget GUID is valid"), RootCanvasGuid.IsValid());
	}

	ExpectSuccessfulResult(
		Test,
		Subsystem->BuildWidgetTree(
			WidgetObjectPath,
			TEXT(R"json({"class":"CanvasPanel","name":"RootCanvas","is_variable":true,"children":[{"class":"TextBlock","name":"BodyText","is_variable":true}]})json"),
			false),
		TEXT("BuildWidgetTree rebuild"));

	WidgetBP = Cast<UWidgetBlueprint>(ResolveAssetByPath(WidgetObjectPath));
	Test.TestNotNull(TEXT("Widget blueprint exists after rebuild"), WidgetBP);
	if (WidgetBP)
	{
		Test.TestTrue(TEXT("Rebuilt root widget GUID is preserved"), WidgetBP->WidgetVariableNameToGuidMap.FindRef(RootCanvasName) == RootCanvasGuid);
		Test.TestTrue(TEXT("Rebuilt child widget GUID is added before compile"), WidgetBP->WidgetVariableNameToGuidMap.Contains(BodyTextName));
		Test.TestFalse(TEXT("Removed child widget GUID is pruned during rebuild"), WidgetBP->WidgetVariableNameToGuidMap.Contains(TitleTextName));
	}

	ExpectSuccessfulResult(
		Test,
		Subsystem->CompileWidgetBlueprint(WidgetObjectPath),
		TEXT("CompileWidgetBlueprint after rebuild"));

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

static bool RunMaterialCoverage(FAutomationTestBase& Test)
{
	UBlueprintExtractorSubsystem* Subsystem = GetSubsystem(Test);
	if (!Subsystem)
	{
		return false;
	}

	const FString MaterialAssetPath = MakeUniqueAssetPath(TEXT("M_GraphSmoke"));
	const FString MaterialFunctionAssetPath = MakeUniqueAssetPath(TEXT("MF_GraphSmoke"));
	const FString MaterialLayerAssetPath = MakeUniqueAssetPath(TEXT("MFL_GraphSmoke"));
	const FString MaterialLayerBlendAssetPath = MakeUniqueAssetPath(TEXT("MFLB_GraphSmoke"));
	const FString MaterialInstanceAssetPath = MakeUniqueAssetPath(TEXT("MI_GraphSmoke"));

	const FString MaterialObjectPath = MakeObjectPath(MaterialAssetPath);
	const FString MaterialFunctionObjectPath = MakeObjectPath(MaterialFunctionAssetPath);
	const FString MaterialLayerObjectPath = MakeObjectPath(MaterialLayerAssetPath);
	const FString MaterialLayerBlendObjectPath = MakeObjectPath(MaterialLayerBlendAssetPath);
	const FString MaterialInstanceObjectPath = MakeObjectPath(MaterialInstanceAssetPath);

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateMaterial(
			MaterialAssetPath,
			DefaultTexturePath,
			TEXT(R"json({"twoSided":true,"blendMode":"BLEND_Opaque","materialDomain":"MD_Surface"})json"),
			false),
		TEXT("CreateMaterial"));

	const FString MaterialPayload = TEXT(R"json({
		"compileAfter":true,
		"layoutAfter":true,
		"operations":[
			{"operation":"add_expression","expressionClass":"/Script/Engine.MaterialExpressionVectorParameter","tempId":"baseColor","editorX":-420,"editorY":-80,"properties":{"ParameterName":"BaseColorTint","Group":"Surface","DefaultValue":{"r":0.25,"g":0.5,"b":0.75,"a":1.0}}},
			{"operation":"add_expression","expressionClass":"/Script/Engine.MaterialExpressionScalarParameter","tempId":"roughness","editorX":-420,"editorY":120,"properties":{"ParameterName":"SurfaceRoughness","Group":"Surface","DefaultValue":0.35}},
			{"operation":"add_expression","expressionClass":"/Script/Engine.MaterialExpressionAdd","tempId":"unusedAdd","editorX":-120,"editorY":220},
			{"operation":"connect_material_property","fromTempId":"baseColor","materialProperty":"MP_BaseColor"},
			{"operation":"connect_material_property","fromTempId":"roughness","materialProperty":"MP_Roughness"},
			{"operation":"connect_expressions","fromTempId":"roughness","toTempId":"unusedAdd","toInputName":"A"},
			{"operation":"disconnect_expression_input","tempId":"unusedAdd","inputName":"A"},
			{"operation":"move_expression","tempId":"unusedAdd","editorX":-40,"editorY":260},
			{"operation":"set_expression_properties","tempId":"roughness","properties":{"DefaultValue":0.45}},
			{"operation":"rename_parameter_group","oldGroupName":"Surface","newGroupName":"Shading"},
			{"operation":"add_comment","tempId":"note","editorX":-520,"editorY":-220,"properties":{"Text":"Material smoke"}},
			{"operation":"duplicate_expression","sourceTempId":"roughness","tempId":"roughnessCopy","editorX":-420,"editorY":260},
			{"operation":"delete_expression","tempId":"roughnessCopy"},
			{"operation":"delete_comment","tempId":"note"},
			{"operation":"set_material_settings","settings":{"twoSided":true,"opacityMaskClipValue":0.33,"usageFlags":["MATUSAGE_StaticMesh"]}}
		]
	})json");

	ExpectValidateOnlyResult(
		Test,
		Subsystem->ModifyMaterial(MaterialObjectPath, MaterialPayload, true),
		TEXT("ModifyMaterial validate_only"));

	const TSharedPtr<FJsonObject> ModifyMaterialResult = ExpectSuccessfulResult(
		Test,
		Subsystem->ModifyMaterial(MaterialObjectPath, MaterialPayload, false),
		TEXT("ModifyMaterial"));
	if (ModifyMaterialResult.IsValid())
	{
		TSharedPtr<FJsonObject> TempIdMap;
		Test.TestTrue(TEXT("ModifyMaterial returns created expression tempId map"), TryGetObjectFieldCopy(ModifyMaterialResult, TEXT("tempIdMap"), TempIdMap) && TempIdMap.IsValid());
	}

	ExpectSuccessfulResult(
		Test,
		Subsystem->CompileMaterialAsset(MaterialObjectPath),
		TEXT("CompileMaterialAsset material"));

	const TSharedPtr<FJsonObject> ExtractMaterialResult = ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractMaterial(MaterialObjectPath, false),
		TEXT("ExtractMaterial"));
	if (!ExtractMaterialResult.IsValid())
	{
		return false;
	}

	TSharedPtr<FJsonObject> MaterialJson;
	Test.TestTrue(TEXT("ExtractMaterial returns a material object"), TryGetObjectFieldCopy(ExtractMaterialResult, TEXT("material"), MaterialJson) && MaterialJson.IsValid());
	if (!MaterialJson.IsValid())
	{
		return false;
	}

	Test.TestEqual(TEXT("ExtractMaterial preserves the material path"), MaterialJson->GetStringField(TEXT("assetPath")), MaterialObjectPath);
	Test.TestEqual(TEXT("ExtractMaterial reports shading model"), MaterialJson->GetStringField(TEXT("shadingModel")), FString(TEXT("DefaultLit")));
	Test.TestTrue(TEXT("ExtractMaterial reports used shading models"), MaterialJson->GetStringField(TEXT("usedShadingModels")).Contains(TEXT("DefaultLit")));
	Test.TestNotNull(
		TEXT("ExtractMaterial reports BaseColor property connection"),
		FindArrayObjectByStringField(MaterialJson, TEXT("propertyConnections"), TEXT("property"), TEXT("MP_BaseColor")).Get());
	Test.TestNotNull(
		TEXT("ExtractMaterial reports renamed parameter group"),
		FindArrayObjectByStringField(MaterialJson, TEXT("parameterGroups"), TEXT("groupName"), TEXT("Shading")).Get());

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateMaterialInstance(
			MaterialInstanceAssetPath,
			MaterialObjectPath,
			false),
		TEXT("CreateMaterialInstance from generated material"));

	const FString MaterialInstancePayload = TEXT(R"json({
		"scalarParameters":[{"name":"SurfaceRoughness","value":0.6}],
		"vectorParameters":[{"name":"BaseColorTint","value":{"r":0.9,"g":0.2,"b":0.1,"a":1.0}}]
	})json");

	ExpectValidateOnlyResult(
		Test,
		Subsystem->ModifyMaterialInstance(MaterialInstanceObjectPath, MaterialInstancePayload, true),
		TEXT("ModifyMaterialInstance validate_only material graph"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->ModifyMaterialInstance(MaterialInstanceObjectPath, MaterialInstancePayload, false),
		TEXT("ModifyMaterialInstance material graph"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->CompileMaterialAsset(MaterialInstanceObjectPath),
		TEXT("CompileMaterialAsset material instance"));

	const TSharedPtr<FJsonObject> ExtractMaterialInstanceResult = ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractMaterialInstance(MaterialInstanceObjectPath),
		TEXT("ExtractMaterialInstance graph"));
	if (!ExtractMaterialInstanceResult.IsValid())
	{
		return false;
	}

	TSharedPtr<FJsonObject> MaterialInstanceJson;
	Test.TestTrue(TEXT("ExtractMaterialInstance returns a materialInstance object"), TryGetObjectFieldCopy(ExtractMaterialInstanceResult, TEXT("materialInstance"), MaterialInstanceJson) && MaterialInstanceJson.IsValid());
	if (MaterialInstanceJson.IsValid())
	{
		Test.TestNotNull(
			TEXT("ExtractMaterialInstance exposes vector parameter override"),
			FindArrayObjectByStringField(MaterialInstanceJson, TEXT("vectorParameters"), TEXT("name"), TEXT("BaseColorTint")).Get());
		Test.TestNotNull(
			TEXT("ExtractMaterialInstance exposes scalar parameter override"),
			FindArrayObjectByStringField(MaterialInstanceJson, TEXT("scalarParameters"), TEXT("name"), TEXT("SurfaceRoughness")).Get());
	}

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateMaterialFunction(
			MaterialFunctionAssetPath,
			TEXT("function"),
			TEXT("{}"),
			false),
		TEXT("CreateMaterialFunction"));

	const FString MaterialFunctionPayload = TEXT(R"json({
		"compileAfter":true,
		"layoutAfter":true,
		"operations":[
			{"operation":"add_expression","expressionClass":"/Script/Engine.MaterialExpressionFunctionInput","tempId":"inputColor","editorX":-320,"editorY":0,"properties":{"InputName":"InputColor","InputType":"FunctionInput_Vector3"}},
			{"operation":"add_expression","expressionClass":"/Script/Engine.MaterialExpressionFunctionOutput","tempId":"resultOutput","editorX":40,"editorY":0,"properties":{"OutputName":"Result"}},
			{"operation":"connect_expressions","fromTempId":"inputColor","toTempId":"resultOutput"}
		]
	})json");

	ExpectValidateOnlyResult(
		Test,
		Subsystem->ModifyMaterialFunction(MaterialFunctionObjectPath, MaterialFunctionPayload, true),
		TEXT("ModifyMaterialFunction validate_only"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->ModifyMaterialFunction(MaterialFunctionObjectPath, MaterialFunctionPayload, false),
		TEXT("ModifyMaterialFunction"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->CompileMaterialAsset(MaterialFunctionObjectPath),
		TEXT("CompileMaterialAsset material function"));

	const TSharedPtr<FJsonObject> ExtractMaterialFunctionResult = ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractMaterialFunction(MaterialFunctionObjectPath, false),
		TEXT("ExtractMaterialFunction"));
	if (!ExtractMaterialFunctionResult.IsValid())
	{
		return false;
	}

	TSharedPtr<FJsonObject> MaterialFunctionJson;
	Test.TestTrue(TEXT("ExtractMaterialFunction returns a materialFunction object"), TryGetObjectFieldCopy(ExtractMaterialFunctionResult, TEXT("materialFunction"), MaterialFunctionJson) && MaterialFunctionJson.IsValid());
	if (MaterialFunctionJson.IsValid())
	{
		Test.TestEqual(TEXT("Material function extract reports the correct kind"), MaterialFunctionJson->GetStringField(TEXT("assetKind")), FString(TEXT("function")));

		const TArray<TSharedPtr<FJsonValue>>* FunctionInputs = nullptr;
		const TArray<TSharedPtr<FJsonValue>>* FunctionOutputs = nullptr;
		Test.TestTrue(TEXT("Material function extract lists function inputs"), MaterialFunctionJson->TryGetArrayField(TEXT("functionInputs"), FunctionInputs) && FunctionInputs && FunctionInputs->Num() == 1);
		Test.TestTrue(TEXT("Material function extract lists function outputs"), MaterialFunctionJson->TryGetArrayField(TEXT("functionOutputs"), FunctionOutputs) && FunctionOutputs && FunctionOutputs->Num() == 1);
	}

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateMaterialFunction(
			MaterialLayerAssetPath,
			TEXT("layer"),
			TEXT("{}"),
			false),
		TEXT("CreateMaterialFunction layer"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateMaterialFunction(
			MaterialLayerBlendAssetPath,
			TEXT("layer_blend"),
			TEXT("{}"),
			false),
		TEXT("CreateMaterialFunction layer_blend"));

	const TSharedPtr<FJsonObject> ExtractLayerResult = ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractMaterialFunction(MaterialLayerObjectPath, false),
		TEXT("ExtractMaterialLayer"));
	if (ExtractLayerResult.IsValid())
	{
		TSharedPtr<FJsonObject> LayerJson;
		Test.TestTrue(TEXT("ExtractMaterialLayer returns a materialFunction object"), TryGetObjectFieldCopy(ExtractLayerResult, TEXT("materialFunction"), LayerJson) && LayerJson.IsValid());
		if (LayerJson.IsValid())
		{
			Test.TestEqual(TEXT("Material layer extract reports the correct kind"), LayerJson->GetStringField(TEXT("assetKind")), FString(TEXT("layer")));
		}
	}

	const TSharedPtr<FJsonObject> ExtractLayerBlendResult = ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractMaterialFunction(MaterialLayerBlendObjectPath, false),
		TEXT("ExtractMaterialLayerBlend"));
	if (ExtractLayerBlendResult.IsValid())
	{
		TSharedPtr<FJsonObject> LayerBlendJson;
		Test.TestTrue(TEXT("ExtractMaterialLayerBlend returns a materialFunction object"), TryGetObjectFieldCopy(ExtractLayerBlendResult, TEXT("materialFunction"), LayerBlendJson) && LayerBlendJson.IsValid());
		if (LayerBlendJson.IsValid())
		{
			Test.TestEqual(TEXT("Material layer blend extract reports the correct kind"), LayerBlendJson->GetStringField(TEXT("assetKind")), FString(TEXT("layer_blend")));
		}
	}

	const TArray<FString> AssetsToSave = {
		MaterialObjectPath,
		MaterialFunctionObjectPath,
		MaterialLayerObjectPath,
		MaterialLayerBlendObjectPath,
		MaterialInstanceObjectPath,
	};

	ExpectSuccessfulResult(
		Test,
		Subsystem->SaveAssets(SerializeStringArray(AssetsToSave)),
		TEXT("SaveAssets material coverage"));

	Test.TestTrue(TEXT("Material .uasset file exists after SaveAssets"), FPaths::FileExists(MakePackageFilename(MaterialAssetPath)));
	return true;
}

static bool RunImportCoverage(FAutomationTestBase& Test)
{
	UBlueprintExtractorSubsystem* Subsystem = GetSubsystem(Test);
	if (!Subsystem)
	{
		return false;
	}

	const FString ImportRoot = FString::Printf(TEXT("%s/Imported"), ScratchRoot);
	const FString TextureAssetPath = ImportRoot + TEXT("/T_Imported");
	const FString MeshAssetPath = ImportRoot + TEXT("/SM_Imported");
	const FString TextureObjectPath = MakeObjectPath(TextureAssetPath);
	const FString MeshObjectPath = MakeObjectPath(MeshAssetPath);

	const TSharedPtr<FJsonObject> TextureImportResult = WaitForImportJob(
		Test,
		Subsystem,
		Subsystem->ImportTextures(
			FString::Printf(
				TEXT(R"json({"items":[{"file_path":"%s","destination_path":"%s","destination_name":"T_Imported","options":{"srgb":false,"flip_green_channel":true}}]})json"),
				TextureImportSource,
				*ImportRoot),
			false),
		TEXT("ImportTextures"));
	Test.TestTrue(TEXT("Texture import completes"), TextureImportResult.IsValid());
	Test.TestTrue(
		TEXT("Texture import reports imported object path"),
		JsonArrayContainsString(TextureImportResult, TEXT("importedObjects"), TextureObjectPath));

	const TSharedPtr<FJsonObject> MeshImportResult = WaitForImportJob(
		Test,
		Subsystem,
		Subsystem->ImportMeshes(
			FString::Printf(
				TEXT(R"json({"items":[{"file_path":"%s","destination_path":"%s","destination_name":"SM_Imported","options":{"mesh_type":"static","combine_meshes":true,"generate_collision":true}}]})json"),
				MeshImportSource,
				*ImportRoot),
			false),
		TEXT("ImportMeshes"));
	Test.TestTrue(TEXT("Mesh import completes"), MeshImportResult.IsValid());
	Test.TestTrue(
		TEXT("Mesh import reports imported object path"),
		JsonArrayContainsString(MeshImportResult, TEXT("importedObjects"), MeshObjectPath));

	UTexture* ImportedTexture = Cast<UTexture>(ResolveAssetByPath(TextureObjectPath));
	Test.TestNotNull(TEXT("Imported texture exists"), ImportedTexture);
	if (ImportedTexture)
	{
		Test.TestFalse(TEXT("Imported texture applied sRGB override"), ImportedTexture->SRGB);
	}

	const TSharedPtr<FJsonObject> ReimportResult = WaitForImportJob(
		Test,
		Subsystem,
		Subsystem->ReimportAssets(
			FString::Printf(
				TEXT(R"json({"items":[{"asset_path":"%s","file_path":"%s"}]})json"),
				*TextureObjectPath,
				TextureImportSourceAlt),
			false),
		TEXT("ReimportAssets"));
	Test.TestTrue(TEXT("Texture reimport completes"), ReimportResult.IsValid());
	Test.TestTrue(
		TEXT("Texture reimport reports imported object path"),
		JsonArrayContainsString(ReimportResult, TEXT("importedObjects"), TextureObjectPath));

	ImportedTexture = Cast<UTexture>(ResolveAssetByPath(TextureObjectPath));
	if (ImportedTexture && ImportedTexture->AssetImportData)
	{
		Test.TestTrue(
			TEXT("Reimport updates texture source path"),
			ImportedTexture->AssetImportData->GetFirstFilename().EndsWith(TEXT("T_Test_Alt.png")));
	}

	const TSharedPtr<FJsonObject> ReplaceExistingResult = WaitForImportJob(
		Test,
		Subsystem,
		Subsystem->ImportTextures(
			FString::Printf(
				TEXT(R"json({"items":[{"file_path":"%s","destination_path":"%s","destination_name":"T_Imported","replace_existing":true}]})json"),
				TextureImportSource,
				*ImportRoot),
			false),
		TEXT("ImportTextures replace_existing"));
	Test.TestTrue(TEXT("Replace-existing import completes"), ReplaceExistingResult.IsValid());

	const TSharedPtr<FJsonObject> MissingSourceResult = ParseJsonObject(
		Test,
		Subsystem->ImportAssets(
			FString::Printf(
				TEXT(R"json({"items":[{"file_path":"ImportSources/DoesNotExist.png","destination_path":"%s","destination_name":"Missing"}]})json"),
				*ImportRoot),
			false),
		TEXT("ImportAssets missing source"));
	Test.TestTrue(TEXT("Missing source import fails"), IsFailureResult(MissingSourceResult));

	const TSharedPtr<FJsonObject> UnsupportedMeshResult = ParseJsonObject(
		Test,
		Subsystem->ImportMeshes(
			FString::Printf(
				TEXT(R"json({"items":[{"file_path":"%s","destination_path":"%s","destination_name":"BadMesh","options":{"mesh_type":"static"}}]})json"),
				TextureImportSource,
				*ImportRoot),
			false),
		TEXT("ImportMeshes unsupported extension"));
	Test.TestTrue(TEXT("Unsupported mesh helper extension fails"), IsFailureResult(UnsupportedMeshResult));

	const TArray<FString> AssetsToSave = {TextureObjectPath, MeshObjectPath};
	const TSharedPtr<FJsonObject> SaveResult = ExpectSuccessfulResult(
		Test,
		Subsystem->SaveAssets(SerializeStringArray(AssetsToSave)),
		TEXT("Save imported assets"));
	if (SaveResult.IsValid() && SaveResult->HasTypedField<EJson::Boolean>(TEXT("saved")))
	{
		Test.TestTrue(TEXT("Save imported assets reports saved=true"), SaveResult->GetBoolField(TEXT("saved")));
	}

	Test.TestTrue(
		TEXT("Imported texture package exists after SaveAssets"),
		FPaths::FileExists(MakePackageFilename(TextureAssetPath)));
	Test.TestTrue(
		TEXT("Imported mesh package exists after SaveAssets"),
		FPaths::FileExists(MakePackageFilename(MeshAssetPath)));
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

static bool RunAbstractWidgetClassCoverage(FAutomationTestBase& Test)
{
	UBlueprintExtractorSubsystem* Subsystem = GetSubsystem(Test);
	if (!Subsystem)
	{
		return false;
	}

	const FString WidgetAssetPath = MakeUniqueAssetPath(TEXT("WBP_AbstractClassGuard"));
	const FString WidgetObjectPath = MakeObjectPath(WidgetAssetPath);

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateWidgetBlueprint(
			WidgetAssetPath,
			TEXT("UserWidget")),
		TEXT("CreateWidgetBlueprint for abstract child guard"));

	const TSharedPtr<FJsonObject> BuildResult = ParseJsonObject(
		Test,
		Subsystem->BuildWidgetTree(
			WidgetObjectPath,
			TEXT(R"json({"class":"CanvasPanel","name":"RootCanvas","is_variable":true,"children":[{"class":"UserWidget","name":"TitleBarArea","is_variable":true}]})json"),
			false),
		TEXT("BuildWidgetTree rejects abstract child class"));

	Test.TestTrue(TEXT("BuildWidgetTree rejects abstract child classes"), IsFailureResult(BuildResult));

	FString Error;
	if (BuildResult.IsValid() && BuildResult->TryGetStringField(TEXT("error"), Error))
	{
		Test.TestTrue(TEXT("BuildWidgetTree reports an abstract-class error"), Error.Contains(TEXT("abstract")));
	}

	return true;
}

static bool RunBindWidgetParentCoverage(FAutomationTestBase& Test)
{
	UBlueprintExtractorSubsystem* Subsystem = GetSubsystem(Test);
	if (!Subsystem)
	{
		return false;
	}

	const FString WidgetAssetPath = MakeUniqueAssetPath(TEXT("WBP_BindWidgetParent"));
	const FString WidgetObjectPath = MakeObjectPath(WidgetAssetPath);

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateWidgetBlueprint(
			WidgetAssetPath,
			FixtureBindWidgetParentClassPath),
		TEXT("CreateWidgetBlueprint for BindWidget parent"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->BuildWidgetTree(
			WidgetObjectPath,
			TEXT(R"json({"class":"VerticalBox","name":"WindowRoot","children":[{"class":"HorizontalBox","name":"TitleBarArea","is_variable":true,"children":[{"class":"TextBlock","name":"TitleText","is_variable":true,"slot":{"Size":{"value":1,"sizeRule":"Fill"}}},{"class":"Button","name":"MinimizeButton","is_variable":true},{"class":"Button","name":"MaximizeButton","is_variable":true},{"class":"Button","name":"CloseButton","is_variable":true}]},{"class":"NamedSlot","name":"ContentSlot","is_variable":true,"slot":{"Size":{"value":1,"sizeRule":"Fill"}}}]})json"),
			false),
		TEXT("BuildWidgetTree for BindWidget parent"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->CompileWidgetBlueprint(WidgetObjectPath),
		TEXT("CompileWidgetBlueprint for BindWidget parent"));

	UWidgetBlueprint* WidgetBP = Cast<UWidgetBlueprint>(ResolveAssetByPath(WidgetObjectPath));
	Test.TestNotNull(TEXT("BindWidget parent widget blueprint exists"), WidgetBP);
	if (!WidgetBP)
	{
		return false;
	}

	auto HasGeneratedVariable = [WidgetBP](const TCHAR* VariableName)
	{
		return WidgetBP->GeneratedVariables.ContainsByPredicate([VariableName](const FBPVariableDescription& Variable)
		{
			return Variable.VarName == FName(VariableName);
		});
	};

	Test.TestFalse(TEXT("TitleBarArea uses native BindWidget property instead of generated variable"), HasGeneratedVariable(TEXT("TitleBarArea")));
	Test.TestFalse(TEXT("TitleText uses native BindWidget property instead of generated variable"), HasGeneratedVariable(TEXT("TitleText")));
	Test.TestFalse(TEXT("MinimizeButton uses native BindWidget property instead of generated variable"), HasGeneratedVariable(TEXT("MinimizeButton")));
	Test.TestFalse(TEXT("MaximizeButton uses native BindWidget property instead of generated variable"), HasGeneratedVariable(TEXT("MaximizeButton")));
	Test.TestFalse(TEXT("CloseButton uses native BindWidget property instead of generated variable"), HasGeneratedVariable(TEXT("CloseButton")));
	Test.TestFalse(TEXT("ContentSlot uses native BindWidget property instead of generated variable"), HasGeneratedVariable(TEXT("ContentSlot")));

	return true;
}

static bool RunWidgetRenameCoverage(FAutomationTestBase& Test)
{
	UBlueprintExtractorSubsystem* Subsystem = GetSubsystem(Test);
	if (!Subsystem)
	{
		return false;
	}

	const FString WidgetAssetPath = MakeUniqueAssetPath(TEXT("WBP_RenameBindWidget"));
	const FString WidgetObjectPath = MakeObjectPath(WidgetAssetPath);

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateWidgetBlueprint(
			WidgetAssetPath,
			FixtureRenameBindWidgetParentClassPath),
		TEXT("CreateWidgetBlueprint for widget rename"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->BuildWidgetTree(
			WidgetObjectPath,
			TEXT(R"json({"class":"CanvasPanel","name":"RootCanvas","children":[{"class":"Image","name":"Shortcuticon","is_variable":true}]})json"),
			false),
		TEXT("BuildWidgetTree for widget rename"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->ModifyWidget(
			WidgetObjectPath,
			TEXT("Shortcuticon"),
			TEXT(R"json({"name":"ShortcutIcon"})json"),
			TEXT("{}"),
			false),
		TEXT("ModifyWidget rename"));

	UWidgetBlueprint* WidgetBP = Cast<UWidgetBlueprint>(ResolveAssetByPath(WidgetObjectPath));
	Test.TestNotNull(TEXT("Renamed widget blueprint exists"), WidgetBP);
	if (!WidgetBP)
	{
		return false;
	}

	UWidget* RenamedWidget = WidgetBP->WidgetTree->FindWidget(TEXT("ShortcutIcon"));
	Test.TestNotNull(TEXT("Renamed widget exists"), RenamedWidget);
	if (RenamedWidget)
	{
		Test.TestEqual(TEXT("Renamed widget preserves requested casing"), RenamedWidget->GetName(), FString(TEXT("ShortcutIcon")));
	}

	const bool bHasGeneratedVariable = WidgetBP->GeneratedVariables.ContainsByPredicate([](const FBPVariableDescription& Variable)
	{
		return Variable.VarName == FName(TEXT("ShortcutIcon"));
	});
	Test.TestFalse(TEXT("Native BindWidget rename does not create generated variable"), bHasGeneratedVariable);

	ExpectSuccessfulResult(
		Test,
		Subsystem->CompileWidgetBlueprint(WidgetObjectPath),
		TEXT("CompileWidgetBlueprint after widget rename"));

	return true;
}

static bool RunWidgetSlotAliasCoverage(FAutomationTestBase& Test)
{
	UBlueprintExtractorSubsystem* Subsystem = GetSubsystem(Test);
	if (!Subsystem)
	{
		return false;
	}

	const FString WidgetAssetPath = MakeUniqueAssetPath(TEXT("WBP_SlotAlias"));
	const FString WidgetObjectPath = MakeObjectPath(WidgetAssetPath);

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateWidgetBlueprint(
			WidgetAssetPath,
			TEXT("UserWidget")),
		TEXT("CreateWidgetBlueprint for slot alias"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->BuildWidgetTree(
			WidgetObjectPath,
			TEXT(R"json({"class":"VerticalBox","name":"WindowRoot","children":[{"class":"Border","name":"TitleBarArea","is_variable":true,"slot":{"Size":{"value":1,"sizeRule":"Fill"}}}]})json"),
			false),
		TEXT("BuildWidgetTree for slot alias"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->ModifyWidget(
			WidgetObjectPath,
			TEXT("TitleBarArea"),
			TEXT("{}"),
			TEXT(R"json({"Size":{"value":0,"sizeRule":"Auto"}})json"),
			false),
		TEXT("ModifyWidget slot alias"));

	UWidgetBlueprint* WidgetBP = Cast<UWidgetBlueprint>(ResolveAssetByPath(WidgetObjectPath));
	Test.TestNotNull(TEXT("Slot alias widget blueprint exists"), WidgetBP);
	if (!WidgetBP)
	{
		return false;
	}

	UWidget* TitleBarArea = WidgetBP->WidgetTree->FindWidget(TEXT("TitleBarArea"));
	Test.TestNotNull(TEXT("TitleBarArea exists"), TitleBarArea);

	UVerticalBoxSlot* VerticalSlot = TitleBarArea ? Cast<UVerticalBoxSlot>(TitleBarArea->Slot) : nullptr;
	Test.TestNotNull(TEXT("TitleBarArea uses a VerticalBox slot"), VerticalSlot);
	if (VerticalSlot)
	{
		const FSlateChildSize SlotSize = VerticalSlot->GetSize();
		Test.TestEqual(TEXT("Auto alias maps to Automatic"), static_cast<int32>(SlotSize.SizeRule), static_cast<int32>(ESlateSizeRule::Automatic));
		Test.TestEqual(TEXT("Slot value override is applied"), SlotSize.Value, 0.0f);
	}

	ExpectSuccessfulResult(
		Test,
		Subsystem->CompileWidgetBlueprint(WidgetObjectPath),
		TEXT("CompileWidgetBlueprint after slot alias"));

	return true;
}

static bool RunWidgetStructureCoverage(FAutomationTestBase& Test)
{
	UBlueprintExtractorSubsystem* Subsystem = GetSubsystem(Test);
	if (!Subsystem)
	{
		return false;
	}

	const FString WidgetAssetPath = MakeUniqueAssetPath(TEXT("WBP_StructureOps"));
	const FString WidgetObjectPath = MakeObjectPath(WidgetAssetPath);

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateWidgetBlueprint(
			WidgetAssetPath,
			TEXT("UserWidget")),
		TEXT("CreateWidgetBlueprint for structure ops"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->BuildWidgetTree(
			WidgetObjectPath,
			TEXT(R"json({"class":"VerticalBox","name":"WindowRoot","is_variable":true,"children":[{"class":"HorizontalBox","name":"HeaderRow","is_variable":true,"children":[{"class":"TextBlock","name":"TitleText","is_variable":true,"properties":{"Text":"Window"}},{"class":"Border","name":"ActionHost","is_variable":true}]},{"class":"VerticalBox","name":"ContentRoot","is_variable":true,"children":[{"class":"TextBlock","name":"BodyText","is_variable":true,"properties":{"Text":"Body"}}]}]})json"),
			false),
		TEXT("BuildWidgetTree for structure ops"));

	ExpectValidateOnlyResult(
		Test,
		Subsystem->ModifyWidgetBlueprintStructure(
			WidgetObjectPath,
			TEXT("batch"),
			TEXT(R"json({"operations":[{"operation":"insert_child","parent_widget_path":"WindowRoot/HeaderRow","child_widget":{"class":"Button","name":"HelpButton","is_variable":true}},{"operation":"wrap_widget","widget_path":"WindowRoot/ContentRoot/BodyText","wrapper_widget":{"class":"Border","name":"BodyFrame"}},{"operation":"move_widget","widget_path":"WindowRoot/HeaderRow/ActionHost","new_parent_widget_path":"WindowRoot/ContentRoot","index":0},{"operation":"patch_widget","widget_path":"WindowRoot/HeaderRow/TitleText","properties":{"Text":"Window Title"}}]})json"),
			true),
		TEXT("ModifyWidgetBlueprintStructure validate_only batch"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->ModifyWidgetBlueprintStructure(
			WidgetObjectPath,
			TEXT("batch"),
			TEXT(R"json({"operations":[{"operation":"insert_child","parent_widget_path":"WindowRoot/HeaderRow","child_widget":{"class":"Button","name":"HelpButton","is_variable":true}},{"operation":"wrap_widget","widget_path":"WindowRoot/ContentRoot/BodyText","wrapper_widget":{"class":"Border","name":"BodyFrame"}},{"operation":"move_widget","widget_path":"WindowRoot/HeaderRow/ActionHost","new_parent_widget_path":"WindowRoot/ContentRoot","index":0},{"operation":"patch_widget","widget_path":"WindowRoot/HeaderRow/TitleText","properties":{"Text":"Window Title"}}]})json"),
			false),
		TEXT("ModifyWidgetBlueprintStructure batch"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->ModifyWidgetBlueprintStructure(
			WidgetObjectPath,
			TEXT("replace_widget_class"),
			TEXT(R"json({"widget_path":"WindowRoot/ContentRoot/ActionHost","replacement_class":"SizeBox","preserve_properties":false})json"),
			false),
		TEXT("ModifyWidgetBlueprintStructure replace_widget_class"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->ModifyWidgetBlueprintStructure(
			WidgetObjectPath,
			TEXT("remove_widget"),
			TEXT(R"json({"widget_path":"WindowRoot/HeaderRow/HelpButton"})json"),
			false),
		TEXT("ModifyWidgetBlueprintStructure remove_widget"));

	const TSharedPtr<FJsonObject> ExtractResult = ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractWidgetBlueprint(WidgetObjectPath),
		TEXT("ExtractWidgetBlueprint after structure ops"));
	if (!ExtractResult.IsValid())
	{
		return false;
	}

	Test.TestEqual(
		TEXT("ExtractWidgetBlueprint reports the expected operation"),
		ExtractResult->GetStringField(TEXT("operation")),
		FString(TEXT("extract_widget_blueprint")));

	TSharedPtr<FJsonObject> RootWidgetJson;
	Test.TestTrue(TEXT("ExtractWidgetBlueprint returns a rootWidget"), TryGetObjectFieldCopy(ExtractResult, TEXT("rootWidget"), RootWidgetJson) && RootWidgetJson.IsValid());
	if (!RootWidgetJson.IsValid())
	{
		return false;
	}

	FString RootWidgetPath;
	Test.TestTrue(TEXT("Root widget exposes widgetPath"), RootWidgetJson->TryGetStringField(TEXT("widgetPath"), RootWidgetPath));
	Test.TestEqual(TEXT("Root widgetPath is annotated"), RootWidgetPath, FString(TEXT("WindowRoot")));

	const TSharedPtr<FJsonObject> ActionHostNode = FindWidgetNodeByPath(RootWidgetJson, TEXT("WindowRoot/ContentRoot/ActionHost"));
	Test.TestNotNull(TEXT("Moved ActionHost exists under ContentRoot"), ActionHostNode.Get());
	if (ActionHostNode.IsValid())
	{
		FString WidgetClass;
		ActionHostNode->TryGetStringField(TEXT("class"), WidgetClass);
		Test.TestEqual(TEXT("replace_widget_class updates the class"), WidgetClass, FString(TEXT("SizeBox")));
	}

	const TSharedPtr<FJsonObject> BodyTextNode = FindWidgetNodeByPath(RootWidgetJson, TEXT("WindowRoot/ContentRoot/BodyFrame/BodyText"));
	Test.TestNotNull(TEXT("wrap_widget preserves the child inside the wrapper"), BodyTextNode.Get());

	const TSharedPtr<FJsonObject> RemovedHelpButton = FindWidgetNodeByPath(RootWidgetJson, TEXT("WindowRoot/HeaderRow/HelpButton"));
	Test.TestNull(TEXT("remove_widget removes the HelpButton"), RemovedHelpButton.Get());

	ExpectSuccessfulResult(
		Test,
		Subsystem->CompileWidgetBlueprint(WidgetObjectPath),
		TEXT("CompileWidgetBlueprint after structure ops"));

	return true;
}

static bool RunCommonUIWidgetCoverage(FAutomationTestBase& Test)
{
	UBlueprintExtractorSubsystem* Subsystem = GetSubsystem(Test);
	if (!Subsystem)
	{
		return false;
	}

	const FString WidgetAssetPath = MakeUniqueAssetPath(TEXT("WBP_CommonUIRoundTrip"));
	const FString WidgetObjectPath = MakeObjectPath(WidgetAssetPath);

	ExpectSuccessfulResult(
		Test,
		Subsystem->CreateWidgetBlueprint(
			WidgetAssetPath,
			TEXT("CommonActivatableWidget")),
		TEXT("CreateWidgetBlueprint for CommonUI"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->BuildWidgetTree(
			WidgetObjectPath,
			TEXT(R"json({"class":"VerticalBox","name":"WindowRoot","is_variable":true,"children":[{"class":"HorizontalBox","name":"HeaderRow","is_variable":true,"children":[{"class":"TextBlock","name":"TitleText","is_variable":true,"properties":{"Text":"Common Window"}},{"class":"Button","name":"CloseButton","is_variable":true}]},{"class":"NamedSlot","name":"ContentSlot","is_variable":true}]})json"),
			false),
		TEXT("BuildWidgetTree for CommonUI"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->ModifyWidgetBlueprintStructure(
			WidgetObjectPath,
			TEXT("insert_child"),
			TEXT(R"json({"parent_widget_path":"WindowRoot/HeaderRow","index":1,"child_widget":{"class":"Button","name":"SecondaryButton","is_variable":true}})json"),
			false),
		TEXT("ModifyWidgetBlueprintStructure insert_child for CommonUI"));

	ExpectSuccessfulResult(
		Test,
		Subsystem->CompileWidgetBlueprint(WidgetObjectPath),
		TEXT("CompileWidgetBlueprint for CommonUI"));

	const TSharedPtr<FJsonObject> ExtractResult = ExpectSuccessfulResult(
		Test,
		Subsystem->ExtractWidgetBlueprint(WidgetObjectPath),
		TEXT("ExtractWidgetBlueprint for CommonUI"));
	if (!ExtractResult.IsValid())
	{
		return false;
	}

	Test.TestEqual(
		TEXT("CommonUI extract reports the expected parentClass"),
		ExtractResult->GetStringField(TEXT("parentClass")),
		FString(TEXT("CommonActivatableWidget")));

	TSharedPtr<FJsonObject> RootWidgetJson;
	Test.TestTrue(TEXT("CommonUI extract returns a rootWidget"), TryGetObjectFieldCopy(ExtractResult, TEXT("rootWidget"), RootWidgetJson) && RootWidgetJson.IsValid());
	if (!RootWidgetJson.IsValid())
	{
		return false;
	}

	const TSharedPtr<FJsonObject> SecondaryButtonNode = FindWidgetNodeByPath(RootWidgetJson, TEXT("WindowRoot/HeaderRow/SecondaryButton"));
	Test.TestNotNull(TEXT("CommonUI structural insert is reflected in extract_widget_blueprint"), SecondaryButtonNode.Get());
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

		It(TEXT("WidgetTreeRejectsAbstractClass"), [this]()
		{
			TestTrue(TEXT("Abstract widget class coverage completes"), RunAbstractWidgetClassCoverage(*this));
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

		It(TEXT("MaterialGraphRoundTrip"), [this]()
		{
			TestTrue(TEXT("Material graph coverage completes"), RunMaterialCoverage(*this));
		});

		It(TEXT("ImportJobs"), [this]()
		{
			TestTrue(TEXT("Import job coverage completes"), RunImportCoverage(*this));
		});

		It(TEXT("BindWidgetParentRoundTrip"), [this]()
		{
			TestTrue(TEXT("BindWidget parent coverage completes"), RunBindWidgetParentCoverage(*this));
		});

		It(TEXT("WidgetRename"), [this]()
		{
			TestTrue(TEXT("Widget rename coverage completes"), RunWidgetRenameCoverage(*this));
		});

		It(TEXT("WidgetSlotAliases"), [this]()
		{
			TestTrue(TEXT("Widget slot alias coverage completes"), RunWidgetSlotAliasCoverage(*this));
		});

		It(TEXT("WidgetStructureOps"), [this]()
		{
			TestTrue(TEXT("Widget structure coverage completes"), RunWidgetStructureCoverage(*this));
		});

		It(TEXT("CommonUIWidgetRoundTrip"), [this]()
		{
			TestTrue(TEXT("CommonUI widget coverage completes"), RunCommonUIWidgetCoverage(*this));
		});
	});
}

#endif // WITH_DEV_AUTOMATION_TESTS
