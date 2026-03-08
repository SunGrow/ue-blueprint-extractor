#include "Builders/WidgetTreeBuilder.h"

#include "WidgetBlueprint.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Widget.h"
#include "Components/PanelWidget.h"
#include "Components/PanelSlot.h"
#include "Blueprint/UserWidget.h"

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "JsonObjectConverter.h"

#include "AssetRegistry/AssetRegistryModule.h"
#include "BlueprintCompilationManager.h"
#include "Kismet2/BlueprintEditorUtils.h"
#include "Kismet2/CompilerResultsLog.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "WidgetBlueprintFactory.h"
#include "Logging/TokenizedMessage.h"

#include "CoreGlobals.h"
#include "UObject/UnrealType.h"

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

} // namespace WidgetTreeBuilderInternal

// ---------------------------------------------------------------------------
// 1. CreateWidgetBlueprint
// ---------------------------------------------------------------------------

TSharedPtr<FJsonObject> FWidgetTreeBuilder::CreateWidgetBlueprint(const FString& AssetPath,
                                                                   const FString& ParentClassName)
{
	using namespace WidgetTreeBuilderInternal;

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
		return MakeErrorResult(FString::Printf(TEXT("Parent class not found: %s"), *EffectiveClassName));
	}

	{
		const bool bIsUserWidgetSubclass = ParentClass->IsChildOf(UUserWidget::StaticClass());
		if (!bIsUserWidgetSubclass)
		{
			return MakeErrorResult(FString::Printf(
				TEXT("Parent class '%s' is not a subclass of UUserWidget"), *ParentClass->GetName()));
		}
	}

	// Create the package
	UPackage* Package = CreatePackage(*AssetPath);
	if (!ensureMsgf(Package, TEXT("WidgetTreeBuilder: Failed to create package at '%s'"), *AssetPath))
	{
		return MakeErrorResult(FString::Printf(TEXT("Failed to create package at: %s"), *AssetPath));
	}

	// Create the widget blueprint via factory
	UWidgetBlueprintFactory* Factory = NewObject<UWidgetBlueprintFactory>();
	if (!ensureMsgf(Factory, TEXT("WidgetTreeBuilder: Failed to create UWidgetBlueprintFactory")))
	{
		return MakeErrorResult(TEXT("Failed to create WidgetBlueprintFactory"));
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
		return MakeErrorResult(FString::Printf(TEXT("FactoryCreateNew failed for: %s"), *AssetPath));
	}

	// Notify asset registry
	FAssetRegistryModule::AssetCreated(CreatedAsset);
	Package->MarkPackageDirty();

	const TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
	Result->SetBoolField(TEXT("success"), true);
	Result->SetStringField(TEXT("assetPath"), AssetPath);
	Result->SetStringField(TEXT("parentClass"), ParentClass->GetName());
	return Result;
}

// ---------------------------------------------------------------------------
// 2. BuildWidgetTree
// ---------------------------------------------------------------------------

TSharedPtr<FJsonObject> FWidgetTreeBuilder::BuildWidgetTree(UWidgetBlueprint* WidgetBP,
                                                            const TSharedPtr<FJsonObject>& RootWidgetJson)
{
	using namespace WidgetTreeBuilderInternal;

	if (!ensureMsgf(WidgetBP, TEXT("WidgetTreeBuilder::BuildWidgetTree: null WidgetBP")))
	{
		return MakeErrorResult(TEXT("WidgetBlueprint is null"));
	}

	if (!RootWidgetJson.IsValid() || RootWidgetJson->Values.Num() == 0)
	{
		return MakeErrorResult(TEXT("RootWidgetJson is null or empty"));
	}

	UWidgetTree* WidgetTree = WidgetBP->WidgetTree;
	if (!ensureMsgf(WidgetTree, TEXT("WidgetTreeBuilder::BuildWidgetTree: null WidgetTree")))
	{
		return MakeErrorResult(TEXT("WidgetTree is null on the WidgetBlueprint"));
	}

	// Clear existing tree
	{
		TArray<UWidget*> AllWidgets;
		WidgetTree->GetAllWidgets(AllWidgets);

		for (UWidget* Widget : AllWidgets)
		{
			WidgetTree->RemoveWidget(Widget);
		}

		WidgetTree->RootWidget = nullptr;
	}

	// Build the new tree from JSON
	TArray<FString> OutErrors;
	UWidget* RootWidget = CreateWidgetFromJson(WidgetTree, nullptr, RootWidgetJson, OutErrors);

	if (!RootWidget)
	{
		return MakeErrorResult(TEXT("Failed to create root widget"), OutErrors);
	}

	WidgetTree->RootWidget = RootWidget;

	// Count total widgets
	TArray<UWidget*> FinalWidgets;
	WidgetTree->GetAllWidgets(FinalWidgets);
	const int32 WidgetCount = FinalWidgets.Num();

	FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(WidgetBP);
	WidgetBP->MarkPackageDirty();

	const TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
	Result->SetBoolField(TEXT("success"), true);
	Result->SetNumberField(TEXT("widgetCount"), WidgetCount);
	Result->SetField(TEXT("errors"), ErrorsToJsonArray(OutErrors));
	return Result;
}

// ---------------------------------------------------------------------------
// 3. ModifyWidget
// ---------------------------------------------------------------------------

TSharedPtr<FJsonObject> FWidgetTreeBuilder::ModifyWidget(UWidgetBlueprint* WidgetBP,
                                                         const FString& WidgetName,
                                                         const TSharedPtr<FJsonObject>& PropertiesJson,
                                                         const TSharedPtr<FJsonObject>& SlotJson)
{
	using namespace WidgetTreeBuilderInternal;

	if (!ensureMsgf(WidgetBP, TEXT("WidgetTreeBuilder::ModifyWidget: null WidgetBP")))
	{
		return MakeErrorResult(TEXT("WidgetBlueprint is null"));
	}

	if (WidgetName.IsEmpty())
	{
		return MakeErrorResult(TEXT("WidgetName is empty"));
	}

	UWidgetTree* WidgetTree = WidgetBP->WidgetTree;
	if (!ensureMsgf(WidgetTree, TEXT("WidgetTreeBuilder::ModifyWidget: null WidgetTree")))
	{
		return MakeErrorResult(TEXT("WidgetTree is null on the WidgetBlueprint"));
	}

	UWidget* Widget = WidgetTree->FindWidget(FName(*WidgetName));
	if (!Widget)
	{
		return MakeErrorResult(FString::Printf(TEXT("Widget not found: %s"), *WidgetName));
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
			UPanelSlot* Slot = Widget->Slot;
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

	const TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
	Result->SetBoolField(TEXT("success"), true);
	Result->SetStringField(TEXT("widgetName"), WidgetName);
	Result->SetStringField(TEXT("widgetClass"), Widget->GetClass()->GetName());
	Result->SetField(TEXT("errors"), ErrorsToJsonArray(OutErrors));
	return Result;
}

// ---------------------------------------------------------------------------
// 4. CompileWidgetBlueprint
// ---------------------------------------------------------------------------

TSharedPtr<FJsonObject> FWidgetTreeBuilder::CompileWidgetBlueprint(UWidgetBlueprint* WidgetBP)
{
	using namespace WidgetTreeBuilderInternal;

	if (!ensureMsgf(WidgetBP, TEXT("WidgetTreeBuilder::CompileWidgetBlueprint: null WidgetBP")))
	{
		return MakeErrorResult(TEXT("WidgetBlueprint is null"));
	}

	if (GCompilingBlueprint || WidgetBP->bBeingCompiled || !FBlueprintCompilationManager::IsGeneratedClassLayoutReady())
	{
		const FString BusyMessage = TEXT("Blueprint compilation is already in progress. Retry after the current compile finishes.");
		const TArray<TSharedPtr<FJsonValue>> EmptyArray;
		TArray<TSharedPtr<FJsonValue>> WarningArray;
		TArray<TSharedPtr<FJsonValue>> MessageArray;
		WarningArray.Add(MakeShared<FJsonValueString>(BusyMessage));
		MessageArray.Add(MakeMessageValue(TEXT("warning"), BusyMessage));
		return MakeCompileResult(false, TEXT("Busy"), EmptyArray, WarningArray, MessageArray, 0, 1);
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

		return MakeCompileResult(true, GetBlueprintStatusString(WidgetBP->Status), EmptyArray, WarningArray, MessageArray, 0, WarningCount);
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
	return MakeCompileResult(bSuccess, StatusString, ErrorArray, WarningArray, MessageArray, ErrorCount, WarningCount);
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

	const UClass* TargetClass = Target->GetClass();

	for (const auto& Pair : PropertiesJson->Values)
	{
		const FString& Key = Pair.Key;
		const TSharedPtr<FJsonValue>& JsonValue = Pair.Value;

		if (!JsonValue.IsValid())
		{
			OutErrors.Add(FString::Printf(TEXT("Null JSON value for property '%s'"), *Key));
			continue;
		}

		// Find the property by name
		FProperty* Property = TargetClass->FindPropertyByName(FName(*Key));
		if (!Property)
		{
			OutErrors.Add(FString::Printf(TEXT("Property '%s' not found on class '%s'"),
				*Key, *TargetClass->GetName()));
			continue;
		}

		void* ValuePtr = Property->ContainerPtrToValuePtr<void>(Target);

		// FBoolProperty
		if (const FBoolProperty* BoolProp = CastField<FBoolProperty>(Property))
		{
			bool bValue = false;
			if (JsonValue->TryGetBool(bValue))
			{
				BoolProp->SetPropertyValue(ValuePtr, bValue);
			}
			else
			{
				OutErrors.Add(FString::Printf(TEXT("Property '%s': expected bool value"), *Key));
			}
			continue;
		}

		// FIntProperty
		if (const FIntProperty* IntProp = CastField<FIntProperty>(Property))
		{
			double NumValue = 0.0;
			if (JsonValue->TryGetNumber(NumValue))
			{
				const int32 IntValue = static_cast<int32>(NumValue);
				IntProp->SetPropertyValue(ValuePtr, IntValue);
			}
			else
			{
				OutErrors.Add(FString::Printf(TEXT("Property '%s': expected numeric value"), *Key));
			}
			continue;
		}

		// FInt64Property
		if (const FInt64Property* Int64Prop = CastField<FInt64Property>(Property))
		{
			double NumValue = 0.0;
			if (JsonValue->TryGetNumber(NumValue))
			{
				const int64 Int64Value = static_cast<int64>(NumValue);
				Int64Prop->SetPropertyValue(ValuePtr, Int64Value);
			}
			else
			{
				OutErrors.Add(FString::Printf(TEXT("Property '%s': expected numeric value"), *Key));
			}
			continue;
		}

		// FFloatProperty
		if (const FFloatProperty* FloatProp = CastField<FFloatProperty>(Property))
		{
			double NumValue = 0.0;
			if (JsonValue->TryGetNumber(NumValue))
			{
				FloatProp->SetPropertyValue(ValuePtr, static_cast<float>(NumValue));
			}
			else
			{
				OutErrors.Add(FString::Printf(TEXT("Property '%s': expected numeric value"), *Key));
			}
			continue;
		}

		// FDoubleProperty
		if (const FDoubleProperty* DoubleProp = CastField<FDoubleProperty>(Property))
		{
			double NumValue = 0.0;
			if (JsonValue->TryGetNumber(NumValue))
			{
				DoubleProp->SetPropertyValue(ValuePtr, NumValue);
			}
			else
			{
				OutErrors.Add(FString::Printf(TEXT("Property '%s': expected numeric value"), *Key));
			}
			continue;
		}

		// FStrProperty
		if (const FStrProperty* StrProp = CastField<FStrProperty>(Property))
		{
			FString StrValue;
			if (JsonValue->TryGetString(StrValue))
			{
				StrProp->SetPropertyValue(ValuePtr, StrValue);
			}
			else
			{
				OutErrors.Add(FString::Printf(TEXT("Property '%s': expected string value"), *Key));
			}
			continue;
		}

		// FNameProperty
		if (const FNameProperty* NameProp = CastField<FNameProperty>(Property))
		{
			FString StrValue;
			if (JsonValue->TryGetString(StrValue))
			{
				NameProp->SetPropertyValue(ValuePtr, FName(*StrValue));
			}
			else
			{
				OutErrors.Add(FString::Printf(TEXT("Property '%s': expected string value for FName"), *Key));
			}
			continue;
		}

		// FTextProperty
		if (const FTextProperty* TextProp = CastField<FTextProperty>(Property))
		{
			FString StrValue;
			if (JsonValue->TryGetString(StrValue))
			{
				const FText TextValue = FText::FromString(StrValue);
				TextProp->SetPropertyValue(ValuePtr, TextValue);
			}
			else
			{
				OutErrors.Add(FString::Printf(TEXT("Property '%s': expected string value for FText"), *Key));
			}
			continue;
		}

		// FEnumProperty
		if (const FEnumProperty* EnumProp = CastField<FEnumProperty>(Property))
		{
			FString StrValue;
			if (JsonValue->TryGetString(StrValue))
			{
				const UEnum* Enum = EnumProp->GetEnum();
				const int64 EnumValue = Enum->GetValueByNameString(StrValue);
				if (EnumValue == INDEX_NONE)
				{
					OutErrors.Add(FString::Printf(TEXT("Property '%s': invalid enum value '%s'"),
						*Key, *StrValue));
				}
				else
				{
					EnumProp->GetUnderlyingProperty()->SetIntPropertyValue(ValuePtr, EnumValue);
				}
			}
			else
			{
				OutErrors.Add(FString::Printf(TEXT("Property '%s': expected string for enum"), *Key));
			}
			continue;
		}

		// FByteProperty (may have an enum)
		if (const FByteProperty* ByteProp = CastField<FByteProperty>(Property))
		{
			if (ByteProp->Enum)
			{
				FString StrValue;
				if (JsonValue->TryGetString(StrValue))
				{
					const int64 EnumValue = ByteProp->Enum->GetValueByNameString(StrValue);
					if (EnumValue == INDEX_NONE)
					{
						OutErrors.Add(FString::Printf(TEXT("Property '%s': invalid enum value '%s'"),
							*Key, *StrValue));
					}
					else
					{
						ByteProp->SetIntPropertyValue(ValuePtr, EnumValue);
					}
				}
				else
				{
					OutErrors.Add(FString::Printf(TEXT("Property '%s': expected string for byte-enum"), *Key));
				}
			}
			else
			{
				double NumValue = 0.0;
				if (JsonValue->TryGetNumber(NumValue))
				{
					ByteProp->SetIntPropertyValue(ValuePtr, static_cast<int64>(NumValue));
				}
				else
				{
					OutErrors.Add(FString::Printf(TEXT("Property '%s': expected numeric value for byte"), *Key));
				}
			}
			continue;
		}

		// FStructProperty
		if (const FStructProperty* StructProp = CastField<FStructProperty>(Property))
		{
			const TSharedPtr<FJsonObject> StructObj = JsonValue->AsObject();
			if (StructObj.IsValid())
			{
				// Use FJsonObjectConverter to deserialize the struct
				const bool bConverted = FJsonObjectConverter::JsonObjectToUStruct(
					StructObj.ToSharedRef(), StructProp->Struct, ValuePtr);

				if (!bConverted)
				{
					OutErrors.Add(FString::Printf(
						TEXT("Property '%s': JsonObjectToUStruct failed for struct '%s'"),
						*Key, *StructProp->Struct->GetName()));
				}
			}
			else
			{
				// Try ImportText from string
				FString StrValue;
				if (JsonValue->TryGetString(StrValue))
				{
					const TCHAR* ImportResult = Property->ImportText_Direct(*StrValue, ValuePtr, Target, PPF_None);
					if (!ImportResult)
					{
						OutErrors.Add(FString::Printf(
							TEXT("Property '%s': ImportText failed for struct value '%s'"),
							*Key, *StrValue));
					}
				}
				else
				{
					OutErrors.Add(FString::Printf(
						TEXT("Property '%s': expected object or string for struct '%s'"),
						*Key, *StructProp->Struct->GetName()));
				}
			}
			continue;
		}

		// FObjectPropertyBase (includes FObjectProperty)
		if (const FObjectPropertyBase* ObjProp = CastField<FObjectPropertyBase>(Property))
		{
			FString PathValue;
			if (JsonValue->TryGetString(PathValue))
			{
				UObject* LoadedObj = StaticLoadObject(UObject::StaticClass(), nullptr, *PathValue);
				if (LoadedObj)
				{
					ObjProp->SetObjectPropertyValue(ValuePtr, LoadedObj);
				}
				else
				{
					OutErrors.Add(FString::Printf(TEXT("Property '%s': failed to load object at '%s'"),
						*Key, *PathValue));
				}
			}
			else
			{
				OutErrors.Add(FString::Printf(TEXT("Property '%s': expected string path for object"), *Key));
			}
			continue;
		}

		// FSoftObjectProperty
		if (const FSoftObjectProperty* SoftObjProp = CastField<FSoftObjectProperty>(Property))
		{
			FString PathValue;
			if (JsonValue->TryGetString(PathValue))
			{
				const FSoftObjectPtr SoftPtr{FSoftObjectPath{PathValue}};
				SoftObjProp->SetPropertyValue(ValuePtr, SoftPtr);
			}
			else
			{
				OutErrors.Add(FString::Printf(TEXT("Property '%s': expected string path for soft object"), *Key));
			}
			continue;
		}

		// FSoftClassProperty
		if (const FSoftClassProperty* SoftClassProp = CastField<FSoftClassProperty>(Property))
		{
			FString PathValue;
			if (JsonValue->TryGetString(PathValue))
			{
				const FSoftObjectPtr SoftPtr{FSoftObjectPath{PathValue}};
				SoftClassProp->SetPropertyValue(ValuePtr, SoftPtr);
			}
			else
			{
				OutErrors.Add(FString::Printf(TEXT("Property '%s': expected string path for soft class"), *Key));
			}
			continue;
		}

		// FClassProperty
		if (const FClassProperty* ClassProp = CastField<FClassProperty>(Property))
		{
			FString PathValue;
			if (JsonValue->TryGetString(PathValue))
			{
				UClass* LoadedClass = StaticLoadClass(ClassProp->MetaClass, nullptr, *PathValue);
				if (LoadedClass)
				{
					ClassProp->SetObjectPropertyValue(ValuePtr, LoadedClass);
				}
				else
				{
					OutErrors.Add(FString::Printf(TEXT("Property '%s': failed to load class at '%s'"),
						*Key, *PathValue));
				}
			}
			else
			{
				OutErrors.Add(FString::Printf(TEXT("Property '%s': expected string path for class"), *Key));
			}
			continue;
		}

		// DEFAULT: try ImportText from string
		{
			FString StrValue;
			if (JsonValue->TryGetString(StrValue))
			{
				const TCHAR* ImportResult = Property->ImportText_Direct(*StrValue, ValuePtr, Target, PPF_None);
				if (!ImportResult)
				{
					OutErrors.Add(FString::Printf(
						TEXT("Property '%s': ImportText failed for value '%s' (type: %s)"),
						*Key, *StrValue, *Property->GetClass()->GetName()));
				}
			}
			else
			{
				OutErrors.Add(FString::Printf(
					TEXT("Property '%s': unsupported property type '%s'"),
					*Key, *Property->GetClass()->GetName()));
			}
		}
	}
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
