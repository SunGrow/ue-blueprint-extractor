#include "Extractors/WidgetTreeExtractor.h"
#include "WidgetBlueprint.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Widget.h"
#include "Components/PanelWidget.h"
#include "Components/PanelSlot.h"
#include "JsonObjectConverter.h"
#include "UObject/UnrealType.h"

TSharedPtr<FJsonObject> FWidgetTreeExtractor::Extract(const UWidgetBlueprint* WidgetBP)
{
	if (!ensureMsgf(WidgetBP, TEXT("WidgetTreeExtractor: null WidgetBlueprint")))
	{
		return nullptr;
	}

	const UWidgetTree* WidgetTree = WidgetBP->WidgetTree;
	if (!WidgetTree)
	{
		return nullptr;
	}

	TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();

	const UWidget* RootWidget = WidgetTree->RootWidget;
	if (RootWidget)
	{
		const TSharedPtr<FJsonObject> RootWidgetJson = ExtractWidget(RootWidget);
		if (RootWidgetJson)
		{
			Result->SetObjectField(TEXT("rootWidget"), RootWidgetJson);
		}
	}

	const TSharedPtr<FJsonObject> BindingsJson = ExtractBindings(WidgetBP);
	if (BindingsJson && 0 < BindingsJson->Values.Num())
	{
		Result->SetObjectField(TEXT("bindings"), BindingsJson);
	}

	return Result;
}

TSharedPtr<FJsonObject> FWidgetTreeExtractor::ExtractWidget(const UWidget* Widget)
{
	if (!Widget)
	{
		return nullptr;
	}

	TSharedPtr<FJsonObject> Obj = MakeShared<FJsonObject>();

	Obj->SetStringField(TEXT("name"), Widget->GetName());
	Obj->SetStringField(TEXT("class"), Widget->GetClass()->GetFName().ToString());

	const FString DisplayLabel = Widget->GetDisplayLabel();
	if (DisplayLabel != Widget->GetName())
	{
		Obj->SetStringField(TEXT("displayLabel"), DisplayLabel);
	}

	Obj->SetBoolField(TEXT("isVariable"), Widget->bIsVariable);

	const ESlateVisibility Visibility = Widget->GetVisibility();
	const FString VisibilityStr = VisibilityToString(Visibility);
	if (VisibilityStr != TEXT("Visible"))
	{
		Obj->SetStringField(TEXT("visibility"), VisibilityStr);
	}

	if (Widget->Slot)
	{
		const TSharedPtr<FJsonObject> SlotJson = ExtractSlot(Widget->Slot);
		if (SlotJson && 0 < SlotJson->Values.Num())
		{
			Obj->SetObjectField(TEXT("slot"), SlotJson);
		}
	}

	const TSharedPtr<FJsonObject> PropertiesJson = ExtractPropertyOverrides(Widget);
	if (PropertiesJson && 0 < PropertiesJson->Values.Num())
	{
		Obj->SetObjectField(TEXT("properties"), PropertiesJson);
	}

	const UPanelWidget* Panel = Cast<UPanelWidget>(Widget);
	if (Panel)
	{
		TArray<TSharedPtr<FJsonValue>> ChildArray;

		for (int32 i = 0; i < Panel->GetChildrenCount(); ++i)
		{
			const UWidget* Child = Panel->GetChildAt(i);
			const TSharedPtr<FJsonObject> ChildJson = ExtractWidget(Child);
			if (ChildJson)
			{
				ChildArray.Add(MakeShared<FJsonValueObject>(ChildJson));
			}
		}

		if (0 < ChildArray.Num())
		{
			Obj->SetArrayField(TEXT("children"), ChildArray);
		}
	}

	return Obj;
}

TSharedPtr<FJsonObject> FWidgetTreeExtractor::ExtractSlot(const UPanelSlot* Slot)
{
	if (!Slot)
	{
		return nullptr;
	}

	TSharedPtr<FJsonObject> Obj = MakeShared<FJsonObject>();

	Obj->SetStringField(TEXT("slotClass"), Slot->GetClass()->GetFName().ToString());

	const TSharedPtr<FJsonObject> SlotProperties = ExtractPropertyOverrides(Slot);
	if (SlotProperties)
	{
		for (const auto& Pair : SlotProperties->Values)
		{
			Obj->SetField(Pair.Key, Pair.Value);
		}
	}

	return Obj;
}

TSharedPtr<FJsonObject> FWidgetTreeExtractor::ExtractPropertyOverrides(const UObject* Object)
{
	TSharedPtr<FJsonObject> Overrides = MakeShared<FJsonObject>();

	if (!Object)
	{
		return Overrides;
	}

	const UClass* ObjectClass = Object->GetClass();
	const UObject* CDO = ObjectClass->GetDefaultObject();

	for (TFieldIterator<FProperty> PropIt(ObjectClass); PropIt; ++PropIt)
	{
		const FProperty* Property = *PropIt;

		if (!Property->HasAnyPropertyFlags(CPF_Edit | CPF_BlueprintVisible))
		{
			continue;
		}

		if (!Property->Identical_InContainer(Object, CDO))
		{
			const void* ValuePtr = Property->ContainerPtrToValuePtr<void>(Object);
			const TSharedPtr<FJsonValue> JsonValue = ExtractPropertyValue(Property, ValuePtr);
			if (JsonValue)
			{
				Overrides->SetField(Property->GetName(), JsonValue);
			}
		}
	}

	return Overrides;
}

TSharedPtr<FJsonValue> FWidgetTreeExtractor::ExtractPropertyValue(const FProperty* Property, const void* ValuePtr)
{
	if (!Property || !ValuePtr)
	{
		return nullptr;
	}

	// Bool
	if (const FBoolProperty* BoolProp = CastField<FBoolProperty>(Property))
	{
		return MakeShared<FJsonValueBoolean>(BoolProp->GetPropertyValue(ValuePtr));
	}

	// Integer types
	if (const FIntProperty* IntProp = CastField<FIntProperty>(Property))
	{
		return MakeShared<FJsonValueNumber>(IntProp->GetPropertyValue(ValuePtr));
	}

	if (const FInt64Property* Int64Prop = CastField<FInt64Property>(Property))
	{
		return MakeShared<FJsonValueNumber>(static_cast<double>(Int64Prop->GetPropertyValue(ValuePtr)));
	}

	// Floating-point types
	if (const FFloatProperty* FloatProp = CastField<FFloatProperty>(Property))
	{
		return MakeShared<FJsonValueNumber>(FloatProp->GetPropertyValue(ValuePtr));
	}

	if (const FDoubleProperty* DoubleProp = CastField<FDoubleProperty>(Property))
	{
		return MakeShared<FJsonValueNumber>(DoubleProp->GetPropertyValue(ValuePtr));
	}

	// String types
	if (const FStrProperty* StrProp = CastField<FStrProperty>(Property))
	{
		return MakeShared<FJsonValueString>(StrProp->GetPropertyValue(ValuePtr));
	}

	if (const FNameProperty* NameProp = CastField<FNameProperty>(Property))
	{
		return MakeShared<FJsonValueString>(NameProp->GetPropertyValue(ValuePtr).ToString());
	}

	if (const FTextProperty* TextProp = CastField<FTextProperty>(Property))
	{
		return MakeShared<FJsonValueString>(TextProp->GetPropertyValue(ValuePtr).ToString());
	}

	// Enum property (FEnumProperty wraps a numeric property with enum metadata)
	if (const FEnumProperty* EnumProp = CastField<FEnumProperty>(Property))
	{
		const UEnum* Enum = EnumProp->GetEnum();
		if (Enum)
		{
			const FNumericProperty* UnderlyingProp = EnumProp->GetUnderlyingProperty();
			const int64 EnumValue = UnderlyingProp->GetSignedIntPropertyValue(ValuePtr);
			const FString EnumName = Enum->GetNameStringByValue(EnumValue);
			return MakeShared<FJsonValueString>(EnumName);
		}
	}

	// ByteProperty with enum
	if (const FByteProperty* ByteProp = CastField<FByteProperty>(Property))
	{
		if (ByteProp->Enum)
		{
			const int64 EnumValue = static_cast<int64>(ByteProp->GetPropertyValue(ValuePtr));
			const FString EnumName = ByteProp->Enum->GetNameStringByValue(EnumValue);
			return MakeShared<FJsonValueString>(EnumName);
		}
	}

	// Struct property — serialize to nested JSON object
	if (const FStructProperty* StructProp = CastField<FStructProperty>(Property))
	{
		const UScriptStruct* ScriptStruct = StructProp->Struct;
		if (ScriptStruct)
		{
			TSharedPtr<FJsonObject> JsonObj = MakeShared<FJsonObject>();
			if (FJsonObjectConverter::UStructToJsonObject(ScriptStruct, ValuePtr, JsonObj.ToSharedRef(), 0, 0))
			{
				return MakeShared<FJsonValueObject>(JsonObj);
			}
		}
	}

	// Soft class property (check before FSoftObjectProperty — more specific subclass)
	if (CastField<FSoftClassProperty>(Property))
	{
		const FSoftObjectPtr& SoftPtr = *static_cast<const FSoftObjectPtr*>(ValuePtr);
		return MakeShared<FJsonValueString>(SoftPtr.ToSoftObjectPath().ToString());
	}

	// Soft object property (check before FObjectPropertyBase — more specific subclass)
	if (CastField<FSoftObjectProperty>(Property))
	{
		const FSoftObjectPtr& SoftPtr = *static_cast<const FSoftObjectPtr*>(ValuePtr);
		return MakeShared<FJsonValueString>(SoftPtr.ToSoftObjectPath().ToString());
	}

	// Object reference (UObject* — covers FObjectProperty, FClassProperty, FWeakObjectProperty, etc.)
	if (const FObjectPropertyBase* ObjProp = CastField<FObjectPropertyBase>(Property))
	{
		const UObject* ReferencedObject = ObjProp->GetObjectPropertyValue(ValuePtr);
		if (ReferencedObject)
		{
			return MakeShared<FJsonValueString>(ReferencedObject->GetPathName());
		}
		return MakeShared<FJsonValueNull>();
	}

	// Default fallback: export as text string
	FString ValueStr;
	Property->ExportText_Direct(ValueStr, ValuePtr, nullptr, nullptr, PPF_None);
	return MakeShared<FJsonValueString>(ValueStr);
}

TSharedPtr<FJsonObject> FWidgetTreeExtractor::ExtractBindings(const UWidgetBlueprint* WidgetBP)
{
	if (!WidgetBP)
	{
		return nullptr;
	}

	const TArray<FDelegateEditorBinding>& Bindings = WidgetBP->Bindings;
	if (Bindings.Num() == 0)
	{
		return nullptr;
	}

	TSharedPtr<FJsonObject> BindingsObj = MakeShared<FJsonObject>();

	for (const FDelegateEditorBinding& Binding : Bindings)
	{
		const FString Key = Binding.ObjectName + TEXT(".") + Binding.PropertyName.ToString();
		const FString Value = Binding.FunctionName.ToString();
		BindingsObj->SetStringField(Key, Value);
	}

	return BindingsObj;
}

FString FWidgetTreeExtractor::VisibilityToString(const ESlateVisibility Visibility)
{
	return StaticEnum<ESlateVisibility>()->GetNameStringByValue(static_cast<int64>(Visibility));
}
