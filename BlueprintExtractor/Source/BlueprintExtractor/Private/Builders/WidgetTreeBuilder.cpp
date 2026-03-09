#include "Builders/WidgetTreeBuilder.h"

#include "Authoring/AssetMutationHelpers.h"
#include "PropertySerializer.h"

#include "WidgetBlueprint.h"
#include "Animation/WidgetAnimation.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Widget.h"
#include "Components/NamedSlot.h"
#include "Components/PanelWidget.h"
#include "Components/PanelSlot.h"
#include "Blueprint/UserWidget.h"

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "JsonObjectConverter.h"

#include "AssetRegistry/AssetRegistryModule.h"
#include "EdGraphSchema_K2.h"
#include "BlueprintCompilationManager.h"
#include "Kismet2/BlueprintEditorUtils.h"
#include "Kismet2/CompilerResultsLog.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "WidgetBlueprintEditorUtils.h"
#include "WidgetBlueprintFactory.h"
#include "Logging/TokenizedMessage.h"

#include "CoreGlobals.h"
#include "UObject/UnrealType.h"
#include "UObject/Package.h"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

namespace WidgetTreeBuilderInternal
{

static TSharedPtr<FJsonObject> MakeErrorResult(const FString& ErrorMessage)
{
	const TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
	Result->SetBoolField(TEXT("success"), false);
	Result->SetStringField(TEXT("error"), ErrorMessage);
	return Result;
}

static TSharedPtr<FJsonObject> MakeErrorResult(const FString& ErrorMessage, const TArray<FString>& Errors)
{
	const TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
	Result->SetBoolField(TEXT("success"), false);
	Result->SetStringField(TEXT("error"), ErrorMessage);

	TArray<TSharedPtr<FJsonValue>> ErrorArray;
	for (const FString& Err : Errors)
	{
		ErrorArray.Add(MakeShared<FJsonValueString>(Err));
	}
	Result->SetArrayField(TEXT("errors"), ErrorArray);
	return Result;
}

static TSharedRef<FJsonValueArray> ErrorsToJsonArray(const TArray<FString>& Errors)
{
	TArray<TSharedPtr<FJsonValue>> Array;
	for (const FString& Err : Errors)
	{
		Array.Add(MakeShared<FJsonValueString>(Err));
	}
	return MakeShared<FJsonValueArray>(Array);
}

static void AddLegacyErrorFields(const TSharedPtr<FJsonObject>& Result, const TArray<FString>& Errors)
{
	if (!Result.IsValid())
	{
		return;
	}

	Result->SetField(TEXT("errors"), ErrorsToJsonArray(Errors));
	if (Errors.Num() > 0)
	{
		Result->SetStringField(TEXT("error"), Errors[0]);
	}
}

static TSharedPtr<FJsonObject> BuildMutationResult(FAssetMutationContext& Context,
                                                   const bool bSuccess,
                                                   const TArray<FString>& Errors)
{
	for (const FString& Error : Errors)
	{
		Context.AddError(TEXT("mutation_error"), Error);
	}

	const TSharedPtr<FJsonObject> Result = Context.BuildResult(bSuccess);
	AddLegacyErrorFields(Result, Errors);
	return Result;
}

static FString GetBlueprintStatusString(const EBlueprintStatus Status)
{
	switch (Status)
	{
	case BS_Unknown:
		return TEXT("Unknown");
	case BS_Dirty:
		return TEXT("Dirty");
	case BS_Error:
		return TEXT("Error");
	case BS_UpToDate:
		return TEXT("UpToDate");
	case BS_BeingCreated:
		return TEXT("BeingCreated");
	case BS_UpToDateWithWarnings:
		return TEXT("UpToDateWithWarnings");
	default:
		return TEXT("Unknown");
	}
}

static TSharedPtr<FJsonValueObject> MakeMessageValue(const FString& Severity, const FString& Message)
{
	const TSharedPtr<FJsonObject> MessageObject = MakeShared<FJsonObject>();
	MessageObject->SetStringField(TEXT("severity"), Severity);
	MessageObject->SetStringField(TEXT("message"), Message);
	return MakeShared<FJsonValueObject>(MessageObject);
}

static TSharedPtr<FJsonObject> MakeCompileResult(const bool bSuccess,
                                                 const FString& StatusString,
                                                 const TArray<TSharedPtr<FJsonValue>>& Errors,
                                                 const TArray<TSharedPtr<FJsonValue>>& Warnings,
                                                 const TArray<TSharedPtr<FJsonValue>>& Messages,
                                                 const int32 ErrorCount,
                                                 const int32 WarningCount)
{
	const TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
	Result->SetBoolField(TEXT("success"), bSuccess);
	Result->SetStringField(TEXT("status"), StatusString);
	Result->SetArrayField(TEXT("errors"), Errors);
	Result->SetArrayField(TEXT("warnings"), Warnings);
	Result->SetArrayField(TEXT("messages"), Messages);
	Result->SetNumberField(TEXT("errorCount"), ErrorCount);
	Result->SetNumberField(TEXT("warningCount"), WarningCount);
	return Result;
}

static void SyncWidgetVariableGuids(UWidgetBlueprint* WidgetBP)
{
#if WITH_EDITORONLY_DATA
	if (!WidgetBP)
	{
		return;
	}

	const TMap<FName, FGuid> ExistingGuids = WidgetBP->WidgetVariableNameToGuidMap;
	TMap<FName, FGuid> RebuiltGuids;

	WidgetBP->ForEachSourceWidget([&ExistingGuids, &RebuiltGuids](UWidget* Widget)
	{
		if (!Widget)
		{
			return;
		}

		const FName WidgetName = Widget->GetFName();
		const FGuid* ExistingGuid = ExistingGuids.Find(WidgetName);
		const FGuid GuidToUse = (ExistingGuid && ExistingGuid->IsValid())
			? *ExistingGuid
			: FGuid::NewDeterministicGuid(Widget->GetPathName());
		RebuiltGuids.Add(WidgetName, GuidToUse);
	});

	// Preserve animation GUIDs across tree rebuilds because animations are not replaced here.
	for (UWidgetAnimation* Animation : WidgetBP->Animations)
	{
		if (Animation)
		{
			const FName AnimationName = Animation->GetFName();
			const FGuid* ExistingGuid = ExistingGuids.Find(AnimationName);
			const FGuid GuidToUse = (ExistingGuid && ExistingGuid->IsValid())
				? *ExistingGuid
				: FGuid::NewDeterministicGuid(Animation->GetPathName());
			RebuiltGuids.Add(AnimationName, GuidToUse);
		}
	}

	WidgetBP->WidgetVariableNameToGuidMap = MoveTemp(RebuiltGuids);
#endif
}

static void SyncGeneratedWidgetVariables(UWidgetBlueprint* WidgetBP)
{
#if WITH_EDITORONLY_DATA
	if (!WidgetBP)
	{
		return;
	}

	TArray<FBPVariableDescription> PreservedVariables;
	PreservedVariables.Reserve(WidgetBP->GeneratedVariables.Num());

	for (FBPVariableDescription& Variable : WidgetBP->GeneratedVariables)
	{
		const UClass* VariableClass = Cast<UClass>(Variable.VarType.PinSubCategoryObject.Get());
		const bool bIsGeneratedWidgetVariable = Variable.VarType.PinCategory == UEdGraphSchema_K2::PC_Object
			&& VariableClass
			&& VariableClass->IsChildOf(UWidget::StaticClass());
		if (!bIsGeneratedWidgetVariable)
		{
			PreservedVariables.Add(MoveTemp(Variable));
		}
	}

	WidgetBP->GeneratedVariables = MoveTemp(PreservedVariables);

	TArray<UWidget*> SortedWidgets = WidgetBP->GetAllSourceWidgets();
	SortedWidgets.Sort([](const UWidget& Lhs, const UWidget& Rhs) { return Rhs.GetFName().LexicalLess(Lhs.GetFName()); });

	for (UWidget* Widget : SortedWidgets)
	{
		if (!Widget)
		{
			continue;
		}

		const bool bShouldGenerateVariable = Widget->bIsVariable
			|| Widget->IsA<UNamedSlot>()
			|| WidgetBP->Bindings.ContainsByPredicate([&Widget](const FDelegateEditorBinding& Binding)
			{
				return Binding.ObjectName == Widget->GetName();
			});
		if (!bShouldGenerateVariable)
		{
			continue;
		}

		FObjectPropertyBase* ExistingProperty = WidgetBP->ParentClass
			? CastField<FObjectPropertyBase>(WidgetBP->ParentClass->FindPropertyByName(Widget->GetFName()))
			: nullptr;
		if (ExistingProperty
			&& FWidgetBlueprintEditorUtils::IsBindWidgetProperty(ExistingProperty)
			&& Widget->IsA(ExistingProperty->PropertyClass))
		{
			continue;
		}

		UClass* WidgetClass = Widget->GetClass();
		if (UBlueprintGeneratedClass* BPWidgetClass = Cast<UBlueprintGeneratedClass>(WidgetClass))
		{
			WidgetClass = BPWidgetClass->GetAuthoritativeClass();
		}

		const FGuid VarGuid = WidgetBP->WidgetVariableNameToGuidMap.FindRef(Widget->GetFName());
		if (!ensure(VarGuid.IsValid()))
		{
			continue;
		}

		FBPVariableDescription WidgetVariableDesc;
		WidgetVariableDesc.VarName = Widget->GetFName();
		WidgetVariableDesc.VarGuid = VarGuid;
		WidgetVariableDesc.VarType = FEdGraphPinType(
			UEdGraphSchema_K2::PC_Object,
			NAME_None,
			WidgetClass,
			EPinContainerType::None,
			false,
			FEdGraphTerminalType());
		WidgetVariableDesc.FriendlyName = Widget->IsGeneratedName()
			? Widget->GetName()
			: Widget->GetLabelText().ToString();
		WidgetVariableDesc.PropertyFlags = CPF_PersistentInstance | CPF_ExportObject | CPF_InstancedReference | CPF_RepSkip;

		if (Widget->bIsVariable)
		{
			WidgetVariableDesc.PropertyFlags |= CPF_BlueprintVisible | CPF_BlueprintReadOnly | CPF_DisableEditOnInstance;

			const FString& CategoryName = Widget->GetCategoryName();
			WidgetVariableDesc.SetMetaData(TEXT("Category"), *(CategoryName.IsEmpty() ? WidgetBP->GetName() : CategoryName));
		}

		WidgetBP->GeneratedVariables.Add(MoveTemp(WidgetVariableDesc));
	}
#endif
}

} // namespace WidgetTreeBuilderInternal

// ---------------------------------------------------------------------------
// 1. CreateWidgetBlueprint
// ---------------------------------------------------------------------------

TSharedPtr<FJsonObject> FWidgetTreeBuilder::CreateWidgetBlueprint(const FString& AssetPath,
                                                                   const FString& ParentClassName)
{
	using namespace WidgetTreeBuilderInternal;

	FAssetMutationContext Context(TEXT("create_widget_blueprint"), AssetPath, TEXT("WidgetBlueprint"), false);

	// Determine the parent class name — default to UserWidget
	const FString EffectiveClassName = ParentClassName.IsEmpty() ? TEXT("UserWidget") : ParentClassName;

	// Resolve the parent class
	UClass* ParentClass = nullptr;
	{
		// Try: "U" + name via FindFirstObject
		const FString UPrefixedName = TEXT("U") + EffectiveClassName;
		ParentClass = FindObject<UClass>(static_cast<UObject*>(nullptr), *UPrefixedName);

		if (!ParentClass)
		{
			ParentClass = FindObject<UClass>(static_cast<UObject*>(nullptr), *EffectiveClassName);
		}

		// Try: StaticLoadClass in UMG (without U prefix — UObject names don't have it)
		if (!ParentClass)
		{
			ParentClass = StaticLoadClass(UUserWidget::StaticClass(), nullptr,
				*(TEXT("/Script/UMG.") + EffectiveClassName));
		}

		// Try: StaticLoadClass in CommonUI
		if (!ParentClass)
		{
			ParentClass = StaticLoadClass(UUserWidget::StaticClass(), nullptr,
				*(TEXT("/Script/CommonUI.") + EffectiveClassName));
		}

		if (!ParentClass)
		{
			// Try full path in case user passed one
			ParentClass = StaticLoadClass(UUserWidget::StaticClass(), nullptr, *EffectiveClassName);
		}
	}

	if (!ParentClass)
	{
		Context.AddError(TEXT("parent_class_not_found"),
		                 FString::Printf(TEXT("Parent class not found: %s"), *EffectiveClassName),
		                 AssetPath);
		return Context.BuildResult(false);
	}

	{
		const bool bIsUserWidgetSubclass = ParentClass->IsChildOf(UUserWidget::StaticClass());
		if (!bIsUserWidgetSubclass)
		{
			Context.AddError(TEXT("invalid_parent_class"),
			                 FString::Printf(TEXT("Parent class '%s' is not a subclass of UUserWidget"),
			                 *ParentClass->GetName()),
			                 AssetPath);
			return Context.BuildResult(false);
		}
	}

	if (DoesAssetExist(AssetPath))
	{
		Context.AddError(TEXT("asset_exists"),
		                 FString::Printf(TEXT("Asset already exists: %s"), *AssetPath),
		                 AssetPath);
		return Context.BuildResult(false);
	}

	Context.BeginTransaction(FText::FromString(TEXT("Create Widget Blueprint")));

	// Create the package
	UPackage* Package = CreatePackage(*AssetPath);
	if (!ensureMsgf(Package, TEXT("WidgetTreeBuilder: Failed to create package at '%s'"), *AssetPath))
	{
		Context.AddError(TEXT("package_create_failed"),
		                 FString::Printf(TEXT("Failed to create package at: %s"), *AssetPath),
		                 AssetPath);
		return Context.BuildResult(false);
	}

	// Create the widget blueprint via factory
	UWidgetBlueprintFactory* Factory = NewObject<UWidgetBlueprintFactory>();
	if (!ensureMsgf(Factory, TEXT("WidgetTreeBuilder: Failed to create UWidgetBlueprintFactory")))
	{
		Context.AddError(TEXT("factory_create_failed"), TEXT("Failed to create WidgetBlueprintFactory"));
		return Context.BuildResult(false);
	}
	Factory->ParentClass = ParentClass;

	const FName AssetName = FPackageName::GetShortFName(AssetPath);
	UObject* CreatedAsset = Factory->FactoryCreateNew(
		UWidgetBlueprint::StaticClass(),
		Package,
		AssetName,
		RF_Public | RF_Standalone,
		nullptr,
		GWarn);

	if (!CreatedAsset)
	{
		Context.AddError(TEXT("factory_create_new_failed"),
		                 FString::Printf(TEXT("FactoryCreateNew failed for: %s"), *AssetPath),
		                 AssetPath);
		return Context.BuildResult(false);
	}

	// Notify asset registry
	FAssetRegistryModule::AssetCreated(CreatedAsset);
	Package->MarkPackageDirty();
	Context.TrackDirtyObject(CreatedAsset);
	Context.SetValidationSummary(true, TEXT("WidgetBlueprint creation inputs validated."));

	const TSharedPtr<FJsonObject> Result = Context.BuildResult(true);
	Result->SetStringField(TEXT("assetPath"), AssetPath);
	Result->SetStringField(TEXT("parentClass"), ParentClass->GetName());
	return Result;
}

// ---------------------------------------------------------------------------
// 2. BuildWidgetTree
// ---------------------------------------------------------------------------

TSharedPtr<FJsonObject> FWidgetTreeBuilder::BuildWidgetTree(UWidgetBlueprint* WidgetBP,
                                                            const TSharedPtr<FJsonObject>& RootWidgetJson,
                                                            const bool bValidateOnly)
{
	using namespace WidgetTreeBuilderInternal;

	const FString AssetPath = WidgetBP ? WidgetBP->GetPathName() : FString();
	FAssetMutationContext Context(TEXT("build_widget_tree"), AssetPath, TEXT("WidgetBlueprint"), bValidateOnly);

	if (!ensureMsgf(WidgetBP, TEXT("WidgetTreeBuilder::BuildWidgetTree: null WidgetBP")))
	{
		Context.AddError(TEXT("null_widget_blueprint"), TEXT("WidgetBlueprint is null"));
		return Context.BuildResult(false);
	}

	if (!RootWidgetJson.IsValid() || RootWidgetJson->Values.Num() == 0)
	{
		Context.AddError(TEXT("empty_widget_tree"), TEXT("RootWidgetJson is null or empty"), AssetPath);
		return Context.BuildResult(false);
	}

	UWidgetTree* WidgetTree = WidgetBP->WidgetTree;
	if (!ensureMsgf(WidgetTree, TEXT("WidgetTreeBuilder::BuildWidgetTree: null WidgetTree")))
	{
		Context.AddError(TEXT("null_widget_tree"), TEXT("WidgetTree is null on the WidgetBlueprint"), AssetPath);
		return Context.BuildResult(false);
	}

	// Preflight the payload on a transient tree so bad JSON never clears the live asset.
	TArray<FString> ValidationErrors;
	UWidgetTree* ValidationTree = NewObject<UWidgetTree>(GetTransientPackage(), NAME_None, RF_Transient);
	UWidget* ValidationRoot = CreateWidgetFromJson(ValidationTree, nullptr, RootWidgetJson, ValidationErrors);
	const bool bValidationSuccess = ValidationRoot != nullptr && ValidationErrors.Num() == 0;
	Context.SetValidationSummary(bValidationSuccess,
		bValidationSuccess ? TEXT("Widget tree payload validated.") : TEXT("Widget tree payload failed validation."),
		ValidationErrors);
	if (!bValidationSuccess)
	{
		return BuildMutationResult(Context, false, ValidationErrors);
	}

	if (bValidateOnly)
	{
		return BuildMutationResult(Context, true, {});
	}

	Context.BeginTransaction(FText::FromString(TEXT("Build Widget Tree")));
	WidgetBP->Modify();
	WidgetTree->Modify();

	// Clear existing tree
	{
		TArray<UWidget*> AllWidgets;
		WidgetTree->GetAllWidgets(AllWidgets);

		for (UWidget* Widget : AllWidgets)
		{
			WidgetTree->RemoveWidget(Widget);
		}

		WidgetTree->RootWidget = nullptr;

		// Detach removed widgets from the WidgetTree so the structural recompile
		// does not keep seeing stale source widgets through their Outer chain.
		for (UWidget* Widget : AllWidgets)
		{
			if (Widget && Widget->GetOuter() == WidgetTree)
			{
				Widget->Rename(nullptr, GetTransientPackage());
			}
		}
	}

	// Build the new tree from JSON
	TArray<FString> OutErrors;
	UWidget* RootWidget = CreateWidgetFromJson(WidgetTree, nullptr, RootWidgetJson, OutErrors);

	if (!RootWidget)
	{
		return BuildMutationResult(Context, false, OutErrors);
	}

	WidgetTree->RootWidget = RootWidget;
	SyncWidgetVariableGuids(WidgetBP);
	SyncGeneratedWidgetVariables(WidgetBP);

	// Count total widgets
	TArray<UWidget*> FinalWidgets;
	WidgetTree->GetAllWidgets(FinalWidgets);
	const int32 WidgetCount = FinalWidgets.Num();

	FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(WidgetBP);
	WidgetBP->MarkPackageDirty();
	Context.TrackDirtyObject(WidgetBP);

	const bool bSuccess = OutErrors.Num() == 0;
	const TSharedPtr<FJsonObject> Result = BuildMutationResult(Context, bSuccess, OutErrors);
	Result->SetNumberField(TEXT("widgetCount"), WidgetCount);
	return Result;
}

// ---------------------------------------------------------------------------
// 3. ModifyWidget
// ---------------------------------------------------------------------------

TSharedPtr<FJsonObject> FWidgetTreeBuilder::ModifyWidget(UWidgetBlueprint* WidgetBP,
                                                         const FString& WidgetName,
                                                         const TSharedPtr<FJsonObject>& PropertiesJson,
                                                         const TSharedPtr<FJsonObject>& SlotJson,
                                                         const bool bValidateOnly)
{
	using namespace WidgetTreeBuilderInternal;

	const FString AssetPath = WidgetBP ? WidgetBP->GetPathName() : FString();
	FAssetMutationContext Context(TEXT("modify_widget"), AssetPath, TEXT("WidgetBlueprint"), bValidateOnly);

	if (!ensureMsgf(WidgetBP, TEXT("WidgetTreeBuilder::ModifyWidget: null WidgetBP")))
	{
		Context.AddError(TEXT("null_widget_blueprint"), TEXT("WidgetBlueprint is null"));
		return Context.BuildResult(false);
	}

	if (WidgetName.IsEmpty())
	{
		Context.AddError(TEXT("empty_widget_name"), TEXT("WidgetName is empty"), AssetPath);
		return Context.BuildResult(false);
	}

	UWidgetTree* WidgetTree = WidgetBP->WidgetTree;
	if (!ensureMsgf(WidgetTree, TEXT("WidgetTreeBuilder::ModifyWidget: null WidgetTree")))
	{
		Context.AddError(TEXT("null_widget_tree"), TEXT("WidgetTree is null on the WidgetBlueprint"), AssetPath);
		return Context.BuildResult(false);
	}

	UWidget* Widget = WidgetTree->FindWidget(FName(*WidgetName));
	if (!Widget)
	{
		Context.AddError(TEXT("widget_not_found"),
		                 FString::Printf(TEXT("Widget not found: %s"), *WidgetName),
		                 WidgetName);
		return Context.BuildResult(false);
	}

	TArray<FString> ValidationErrors;
	if (PropertiesJson.IsValid() && PropertiesJson->Values.Num() > 0)
	{
		FPropertySerializer::ApplyPropertiesFromJson(Widget, PropertiesJson, ValidationErrors, true, true);
	}

	UPanelSlot* Slot = Widget->Slot;
	if (SlotJson.IsValid() && SlotJson->Values.Num() > 0)
	{
		if (!Slot)
		{
			ValidationErrors.Add(FString::Printf(TEXT("Widget '%s' has no Slot (root widgets have no slot)"), *WidgetName));
		}
		else
		{
			FPropertySerializer::ApplyPropertiesFromJson(Slot, SlotJson, ValidationErrors, true, true);
		}
	}

	const bool bValidationSuccess = ValidationErrors.Num() == 0;
	Context.SetValidationSummary(bValidationSuccess,
		bValidationSuccess ? TEXT("Widget modification payload validated.") : TEXT("Widget modification payload failed validation."),
		ValidationErrors);
	if (!bValidationSuccess)
	{
		return BuildMutationResult(Context, false, ValidationErrors);
	}

	if (bValidateOnly)
	{
		return BuildMutationResult(Context, true, {});
	}

	Context.BeginTransaction(FText::FromString(TEXT("Modify Widget")));
	WidgetBP->Modify();
	Widget->Modify();
	if (Slot)
	{
		Slot->Modify();
	}

	TArray<FString> OutErrors;

	// Apply property changes
	{
		const bool bHasProperties = PropertiesJson.IsValid() && 0 < PropertiesJson->Values.Num();
		if (bHasProperties)
		{
			SetPropertiesFromJson(Widget, PropertiesJson, OutErrors);
		}
	}

	// Apply slot changes
	{
		const bool bHasSlotData = SlotJson.IsValid() && 0 < SlotJson->Values.Num();
		if (bHasSlotData)
		{
			if (!Slot)
			{
				OutErrors.Add(FString::Printf(
					TEXT("Widget '%s' has no Slot (root widgets have no slot)"), *WidgetName));
			}
			else
			{
				SetSlotPropertiesFromJson(Slot, SlotJson, OutErrors);
			}
		}
	}

	FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(WidgetBP);
	WidgetBP->MarkPackageDirty();
	Context.TrackDirtyObject(WidgetBP);

	const bool bSuccess = OutErrors.Num() == 0;
	const TSharedPtr<FJsonObject> Result = BuildMutationResult(Context, bSuccess, OutErrors);
	Result->SetStringField(TEXT("widgetName"), WidgetName);
	Result->SetStringField(TEXT("widgetClass"), Widget->GetClass()->GetName());
	return Result;
}

// ---------------------------------------------------------------------------
// 4. CompileWidgetBlueprint
// ---------------------------------------------------------------------------

TSharedPtr<FJsonObject> FWidgetTreeBuilder::CompileWidgetBlueprint(UWidgetBlueprint* WidgetBP)
{
	using namespace WidgetTreeBuilderInternal;

	const FString AssetPath = WidgetBP ? WidgetBP->GetPathName() : FString();
	FAssetMutationContext Context(TEXT("compile_widget_blueprint"), AssetPath, TEXT("WidgetBlueprint"), false);

	if (!ensureMsgf(WidgetBP, TEXT("WidgetTreeBuilder::CompileWidgetBlueprint: null WidgetBP")))
	{
		Context.AddError(TEXT("null_widget_blueprint"), TEXT("WidgetBlueprint is null"));
		return Context.BuildResult(false);
	}

	if (GCompilingBlueprint || WidgetBP->bBeingCompiled || !FBlueprintCompilationManager::IsGeneratedClassLayoutReady())
	{
		const FString BusyMessage = TEXT("Blueprint compilation is already in progress. Retry after the current compile finishes.");
		const TArray<TSharedPtr<FJsonValue>> EmptyArray;
		TArray<TSharedPtr<FJsonValue>> WarningArray;
		TArray<TSharedPtr<FJsonValue>> MessageArray;
		WarningArray.Add(MakeShared<FJsonValueString>(BusyMessage));
		MessageArray.Add(MakeMessageValue(TEXT("warning"), BusyMessage));
		const TSharedPtr<FJsonObject> CompileResult = MakeCompileResult(false, TEXT("Busy"), EmptyArray, WarningArray, MessageArray, 0, 1);
		Context.SetCompileSummary(CompileResult);
		Context.AddWarning(TEXT("compile_busy"), BusyMessage, AssetPath);
		return Context.BuildResult(false);
	}

	const bool bHasGeneratedClass = (WidgetBP->GeneratedClass != nullptr);
	const bool bCanUseCachedStatus = bHasGeneratedClass
		&& !WidgetBP->GetOutermost()->IsDirty()
		&& ((WidgetBP->Status == BS_UpToDate) || (WidgetBP->Status == BS_UpToDateWithWarnings));
	if (bCanUseCachedStatus)
	{
		const TArray<TSharedPtr<FJsonValue>> EmptyArray;
		TArray<TSharedPtr<FJsonValue>> WarningArray;
		TArray<TSharedPtr<FJsonValue>> MessageArray;
		int32 WarningCount = 0;

		if (WidgetBP->Status == BS_UpToDateWithWarnings)
		{
			const FString CachedWarningMessage = TEXT("Blueprint is already up to date with warnings. Recompilation was skipped because the asset is clean.");
			WarningArray.Add(MakeShared<FJsonValueString>(CachedWarningMessage));
			MessageArray.Add(MakeMessageValue(TEXT("warning"), CachedWarningMessage));
			WarningCount = 1;
		}
		else
		{
			MessageArray.Add(MakeMessageValue(TEXT("info"), TEXT("Blueprint is already up to date. Recompilation was skipped because the asset is clean.")));
		}

		const TSharedPtr<FJsonObject> CompileResult = MakeCompileResult(true, GetBlueprintStatusString(WidgetBP->Status), EmptyArray, WarningArray, MessageArray, 0, WarningCount);
		Context.SetCompileSummary(CompileResult);
		if (WarningCount > 0)
		{
			Context.AddWarning(TEXT("compile_warning"), TEXT("Blueprint is already up to date with warnings."), AssetPath);
		}
		return Context.BuildResult(true);
	}

	FCompilerResultsLog CompileResults;
	CompileResults.bSilentMode = true;
	CompileResults.bAnnotateMentionedNodes = false;
	FKismetEditorUtilities::CompileBlueprint(WidgetBP, EBlueprintCompileOptions::SkipGarbageCollection, &CompileResults);

	// Determine success from blueprint status
	const EBlueprintStatus Status = WidgetBP->Status;
	const FString StatusString = GetBlueprintStatusString(Status);

	TArray<TSharedPtr<FJsonValue>> ErrorArray;
	TArray<TSharedPtr<FJsonValue>> WarningArray;
	TArray<TSharedPtr<FJsonValue>> MessageArray;
	int32 ErrorCount = CompileResults.NumErrors;
	int32 WarningCount = CompileResults.NumWarnings;

	for (const TSharedRef<FTokenizedMessage>& Message : CompileResults.Messages)
	{
		const FString MessageText = Message->ToText().ToString();
		switch (Message->GetSeverity())
		{
		case EMessageSeverity::Error:
			ErrorArray.Add(MakeShared<FJsonValueString>(MessageText));
			MessageArray.Add(MakeMessageValue(TEXT("error"), MessageText));
			break;
		case EMessageSeverity::Warning:
		case EMessageSeverity::PerformanceWarning:
			WarningArray.Add(MakeShared<FJsonValueString>(MessageText));
			MessageArray.Add(MakeMessageValue(TEXT("warning"), MessageText));
			break;
		default:
			MessageArray.Add(MakeMessageValue(TEXT("info"), MessageText));
			break;
		}
	}

	if ((WidgetBP->GeneratedClass == nullptr) && ErrorCount == 0)
	{
		const FString GeneratedClassMessage = TEXT("GeneratedClass is null after compilation");
		ErrorArray.Add(MakeShared<FJsonValueString>(GeneratedClassMessage));
		MessageArray.Add(MakeMessageValue(TEXT("error"), GeneratedClassMessage));
		ErrorCount++;
	}

	const bool bSuccess = (Status != BS_Error) && (ErrorCount == 0);
	const TSharedPtr<FJsonObject> CompileResult = MakeCompileResult(bSuccess, StatusString, ErrorArray, WarningArray, MessageArray, ErrorCount, WarningCount);
	Context.SetCompileSummary(CompileResult);
	if (!bSuccess)
	{
		Context.AddError(TEXT("compile_failed"),
		                 FString::Printf(TEXT("WidgetBlueprint compile failed with %d errors and %d warnings."), ErrorCount, WarningCount),
		                 AssetPath);
	}
	else if (WarningCount > 0)
	{
		Context.AddWarning(TEXT("compile_warning"),
		                   FString::Printf(TEXT("WidgetBlueprint compile completed with %d warnings."), WarningCount),
		                   AssetPath);
	}
	return Context.BuildResult(bSuccess);
}

// ---------------------------------------------------------------------------
// 5. CreateWidgetFromJson (Private, Recursive)
// ---------------------------------------------------------------------------

UWidget* FWidgetTreeBuilder::CreateWidgetFromJson(UWidgetTree* WidgetTree,
                                                  UPanelWidget* Parent,
                                                  const TSharedPtr<FJsonObject>& WidgetJson,
                                                  TArray<FString>& OutErrors)
{
	if (!WidgetJson.IsValid())
	{
		OutErrors.Add(TEXT("CreateWidgetFromJson: received null JSON"));
		return nullptr;
	}

	if (!WidgetTree)
	{
		OutErrors.Add(TEXT("CreateWidgetFromJson: WidgetTree is null"));
		return nullptr;
	}

	// Read required "class"
	FString ClassName;
	if (!WidgetJson->TryGetStringField(TEXT("class"), ClassName) || ClassName.IsEmpty())
	{
		OutErrors.Add(TEXT("Widget JSON missing required 'class' field"));
		return nullptr;
	}

	// Read required "name"
	FString WidgetName;
	if (!WidgetJson->TryGetStringField(TEXT("name"), WidgetName) || WidgetName.IsEmpty())
	{
		OutErrors.Add(FString::Printf(TEXT("Widget JSON of class '%s' missing required 'name' field"), *ClassName));
		return nullptr;
	}

	// Resolve class
	UClass* ResolvedClass = ResolveWidgetClass(ClassName);
	if (!ResolvedClass)
	{
		OutErrors.Add(FString::Printf(TEXT("Could not resolve widget class: %s"), *ClassName));
		return nullptr;
	}

	if (ResolvedClass->HasAnyClassFlags(CLASS_Abstract))
	{
		OutErrors.Add(FString::Printf(TEXT("Widget class '%s' is abstract and cannot be instantiated in a widget tree"), *ClassName));
		return nullptr;
	}

	// Construct the widget
	UWidget* Widget = WidgetTree->ConstructWidget<UWidget>(ResolvedClass, FName(*WidgetName));
	if (!Widget)
	{
		OutErrors.Add(FString::Printf(TEXT("ConstructWidget failed for class '%s', name '%s'"),
			*ClassName, *WidgetName));
		return nullptr;
	}

	// Read is_variable / isVariable
	{
		bool bIsVariable = false;
		if (WidgetJson->TryGetBoolField(TEXT("is_variable"), bIsVariable)
			|| WidgetJson->TryGetBoolField(TEXT("isVariable"), bIsVariable))
		{
			Widget->bIsVariable = bIsVariable;
		}
	}

	// Add to parent if present
	if (Parent)
	{
		UPanelSlot* NewSlot = Parent->AddChild(Widget);
		if (!NewSlot)
		{
			OutErrors.Add(FString::Printf(TEXT("Failed to add widget '%s' as child of '%s'"),
				*WidgetName, *Parent->GetName()));
		}
	}

	// Apply slot properties
	{
		if (WidgetJson->HasField(TEXT("slot")) && Widget->Slot)
		{
			const TSharedPtr<FJsonObject> SlotJsonObj = WidgetJson->GetObjectField(TEXT("slot"));
			if (SlotJsonObj.IsValid())
			{
				SetSlotPropertiesFromJson(Widget->Slot, SlotJsonObj, OutErrors);
			}
		}
	}

	// Apply widget properties
	{
		if (WidgetJson->HasField(TEXT("properties")))
		{
			const TSharedPtr<FJsonObject> PropsJsonObj = WidgetJson->GetObjectField(TEXT("properties"));
			if (PropsJsonObj.IsValid())
			{
				SetPropertiesFromJson(Widget, PropsJsonObj, OutErrors);
			}
		}
	}

	// Recursively create children
	{
		if (WidgetJson->HasField(TEXT("children")))
		{
			const TArray<TSharedPtr<FJsonValue>>& ChildrenArray = WidgetJson->GetArrayField(TEXT("children"));

			UPanelWidget* PanelWidget = Cast<UPanelWidget>(Widget);
			if (!PanelWidget)
			{
				OutErrors.Add(FString::Printf(
					TEXT("Widget '%s' (class '%s') has children but is not a UPanelWidget"),
					*WidgetName, *ClassName));
			}
			else
			{
				for (const TSharedPtr<FJsonValue>& ChildValue : ChildrenArray)
				{
					if (!ChildValue.IsValid())
					{
						OutErrors.Add(TEXT("Null entry in children array"));
						continue;
					}

					const TSharedPtr<FJsonObject> ChildJson = ChildValue->AsObject();
					if (!ChildJson.IsValid())
					{
						OutErrors.Add(TEXT("Non-object entry in children array"));
						continue;
					}

					CreateWidgetFromJson(WidgetTree, PanelWidget, ChildJson, OutErrors);
				}
			}
		}
	}

	return Widget;
}

// ---------------------------------------------------------------------------
// 6. ResolveWidgetClass (Private)
// ---------------------------------------------------------------------------

UClass* FWidgetTreeBuilder::ResolveWidgetClass(const FString& ClassName)
{
	if (ClassName.IsEmpty())
	{
		return nullptr;
	}

	UClass* Resolved = nullptr;

	// If it starts with "/", treat as a full path
	const bool bIsFullPath = ClassName.StartsWith(TEXT("/"));
	if (bIsFullPath)
	{
		Resolved = StaticLoadClass(UWidget::StaticClass(), nullptr, *ClassName);
		if (Resolved && Resolved->IsChildOf(UWidget::StaticClass()))
		{
			return Resolved;
		}
		return nullptr;
	}

	// Try: FindFirstObject with "U" prefix
	const FString UPrefixedName = TEXT("U") + ClassName;
	Resolved = FindObject<UClass>(static_cast<UObject*>(nullptr), *UPrefixedName);

	// Try: FindFirstObject with original name
	if (!Resolved)
	{
		Resolved = FindObject<UClass>(static_cast<UObject*>(nullptr), *ClassName);
	}

	// Try: StaticLoadClass in UMG with "U" prefix
	if (!Resolved)
	{
		Resolved = StaticLoadClass(UWidget::StaticClass(), nullptr,
			*(TEXT("/Script/UMG.U") + ClassName));
	}

	// Try: StaticLoadClass in CommonUI with "U" prefix
	if (!Resolved)
	{
		Resolved = StaticLoadClass(UWidget::StaticClass(), nullptr,
			*(TEXT("/Script/CommonUI.U") + ClassName));
	}

	// Try: StaticLoadClass in UMG without "U" prefix
	if (!Resolved)
	{
		Resolved = StaticLoadClass(UWidget::StaticClass(), nullptr,
			*(TEXT("/Script/UMG.") + ClassName));
	}

	// Verify it is a widget class
	if (Resolved && !Resolved->IsChildOf(UWidget::StaticClass()))
	{
		return nullptr;
	}

	return Resolved;
}

// ---------------------------------------------------------------------------
// 7. SetPropertiesFromJson (Private — THE CORE METHOD)
// ---------------------------------------------------------------------------

void FWidgetTreeBuilder::SetPropertiesFromJson(UObject* Target,
                                               const TSharedPtr<FJsonObject>& PropertiesJson,
                                               TArray<FString>& OutErrors)
{
	if (!Target || !PropertiesJson.IsValid())
	{
		return;
	}

	FPropertySerializer::ApplyPropertiesFromJson(Target, PropertiesJson, OutErrors, false, true);
}

// ---------------------------------------------------------------------------
// 8. SetSlotPropertiesFromJson (Private — Thin Wrapper)
// ---------------------------------------------------------------------------

void FWidgetTreeBuilder::SetSlotPropertiesFromJson(UPanelSlot* Slot,
                                                   const TSharedPtr<FJsonObject>& SlotJson,
                                                   TArray<FString>& OutErrors)
{
	if (!Slot || !SlotJson.IsValid())
	{
		return;
	}

	SetPropertiesFromJson(Slot, SlotJson, OutErrors);
}
