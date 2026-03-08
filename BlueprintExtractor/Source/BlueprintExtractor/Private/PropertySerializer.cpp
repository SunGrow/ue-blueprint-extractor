#include "PropertySerializer.h"

#include "JsonObjectConverter.h"
#include "UObject/UnrealType.h"

TSharedPtr<FJsonValue> FPropertySerializer::SerializePropertyValue(const FProperty* Property, const void* ValuePtr)
{
	if (!Property || !ValuePtr)
	{
		return nullptr;
	}

	if (const FBoolProperty* BoolProp = CastField<FBoolProperty>(Property))
	{
		return MakeShared<FJsonValueBoolean>(BoolProp->GetPropertyValue(ValuePtr));
	}

	if (const FEnumProperty* EnumProp = CastField<FEnumProperty>(Property))
	{
		if (const UEnum* Enum = EnumProp->GetEnum())
		{
			const FNumericProperty* UnderlyingProp = EnumProp->GetUnderlyingProperty();
			const int64 EnumValue = UnderlyingProp->GetSignedIntPropertyValue(ValuePtr);
			return MakeShared<FJsonValueString>(Enum->GetNameStringByValue(EnumValue));
		}
	}

	if (const FByteProperty* ByteProp = CastField<FByteProperty>(Property))
	{
		if (ByteProp->Enum)
		{
			const int64 EnumValue = static_cast<int64>(ByteProp->GetPropertyValue(ValuePtr));
			return MakeShared<FJsonValueString>(ByteProp->Enum->GetNameStringByValue(EnumValue));
		}

		return MakeShared<FJsonValueNumber>(ByteProp->GetPropertyValue(ValuePtr));
	}

	if (const FInt8Property* Int8Prop = CastField<FInt8Property>(Property))
	{
		return MakeShared<FJsonValueNumber>(Int8Prop->GetPropertyValue(ValuePtr));
	}

	if (const FInt16Property* Int16Prop = CastField<FInt16Property>(Property))
	{
		return MakeShared<FJsonValueNumber>(Int16Prop->GetPropertyValue(ValuePtr));
	}

	if (const FIntProperty* IntProp = CastField<FIntProperty>(Property))
	{
		return MakeShared<FJsonValueNumber>(IntProp->GetPropertyValue(ValuePtr));
	}

	if (const FInt64Property* Int64Prop = CastField<FInt64Property>(Property))
	{
		return MakeShared<FJsonValueNumber>(static_cast<double>(Int64Prop->GetPropertyValue(ValuePtr)));
	}

	if (const FUInt16Property* UInt16Prop = CastField<FUInt16Property>(Property))
	{
		return MakeShared<FJsonValueNumber>(UInt16Prop->GetPropertyValue(ValuePtr));
	}

	if (const FUInt32Property* UInt32Prop = CastField<FUInt32Property>(Property))
	{
		return MakeShared<FJsonValueNumber>(UInt32Prop->GetPropertyValue(ValuePtr));
	}

	if (const FUInt64Property* UInt64Prop = CastField<FUInt64Property>(Property))
	{
		return MakeShared<FJsonValueNumber>(static_cast<double>(UInt64Prop->GetPropertyValue(ValuePtr)));
	}

	if (const FFloatProperty* FloatProp = CastField<FFloatProperty>(Property))
	{
		return MakeShared<FJsonValueNumber>(FloatProp->GetPropertyValue(ValuePtr));
	}

	if (const FDoubleProperty* DoubleProp = CastField<FDoubleProperty>(Property))
	{
		return MakeShared<FJsonValueNumber>(DoubleProp->GetPropertyValue(ValuePtr));
	}

	if (const FNumericProperty* NumericProp = CastField<FNumericProperty>(Property))
	{
		if (NumericProp->IsFloatingPoint())
		{
			return MakeShared<FJsonValueNumber>(NumericProp->GetFloatingPointPropertyValue(ValuePtr));
		}
	}

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

	if (const FArrayProperty* ArrayProp = CastField<FArrayProperty>(Property))
	{
		TArray<TSharedPtr<FJsonValue>> JsonArray;
		FScriptArrayHelper ArrayHelper(ArrayProp, ValuePtr);

		for (int32 Index = 0; Index < ArrayHelper.Num(); ++Index)
		{
			const TSharedPtr<FJsonValue> ElementValue =
				SerializePropertyValue(ArrayProp->Inner, ArrayHelper.GetRawPtr(Index));
			JsonArray.Add(ElementValue ? ElementValue : MakeShared<FJsonValueNull>());
		}

		return MakeShared<FJsonValueArray>(JsonArray);
	}

	if (const FSetProperty* SetProp = CastField<FSetProperty>(Property))
	{
		TArray<TSharedPtr<FJsonValue>> JsonArray;
		FScriptSetHelper SetHelper(SetProp, ValuePtr);

		for (int32 Index = 0; Index < SetHelper.Num(); ++Index)
		{
			if (!SetHelper.IsValidIndex(Index))
			{
				continue;
			}

			const TSharedPtr<FJsonValue> ElementValue =
				SerializePropertyValue(SetProp->ElementProp, SetHelper.GetElementPtr(Index));
			JsonArray.Add(ElementValue ? ElementValue : MakeShared<FJsonValueNull>());
		}

		return MakeShared<FJsonValueArray>(JsonArray);
	}

	if (const FMapProperty* MapProp = CastField<FMapProperty>(Property))
	{
		TSharedPtr<FJsonObject> JsonMap = MakeShared<FJsonObject>();
		FScriptMapHelper MapHelper(MapProp, ValuePtr);

		for (int32 Index = 0; Index < MapHelper.Num(); ++Index)
		{
			if (!MapHelper.IsValidIndex(Index))
			{
				continue;
			}

			FString KeyStr;
			MapProp->KeyProp->ExportText_Direct(KeyStr, MapHelper.GetKeyPtr(Index), nullptr, nullptr, PPF_None);
			const TSharedPtr<FJsonValue> ValueJson =
				SerializePropertyValue(MapProp->ValueProp, MapHelper.GetValuePtr(Index));
			JsonMap->SetField(KeyStr, ValueJson ? ValueJson : MakeShared<FJsonValueNull>());
		}

		return MakeShared<FJsonValueObject>(JsonMap);
	}

	if (const FStructProperty* StructProp = CastField<FStructProperty>(Property))
	{
		if (const UScriptStruct* ScriptStruct = StructProp->Struct)
		{
			TSharedPtr<FJsonObject> JsonObj = MakeShared<FJsonObject>();
			if (FJsonObjectConverter::UStructToJsonObject(ScriptStruct, ValuePtr, JsonObj.ToSharedRef(), 0, 0))
			{
				return MakeShared<FJsonValueObject>(JsonObj);
			}
		}
	}

	if (CastField<FSoftClassProperty>(Property))
	{
		const FSoftObjectPtr& SoftPtr = *static_cast<const FSoftObjectPtr*>(ValuePtr);
		return MakeShared<FJsonValueString>(SoftPtr.ToSoftObjectPath().ToString());
	}

	if (CastField<FSoftObjectProperty>(Property))
	{
		const FSoftObjectPtr& SoftPtr = *static_cast<const FSoftObjectPtr*>(ValuePtr);
		return MakeShared<FJsonValueString>(SoftPtr.ToSoftObjectPath().ToString());
	}

	if (const FObjectPropertyBase* ObjProp = CastField<FObjectPropertyBase>(Property))
	{
		if (const UObject* ReferencedObject = ObjProp->GetObjectPropertyValue(ValuePtr))
		{
			return MakeShared<FJsonValueString>(ReferencedObject->GetPathName());
		}

		return MakeShared<FJsonValueNull>();
	}

	FString ValueStr;
	Property->ExportText_Direct(ValueStr, ValuePtr, nullptr, nullptr, PPF_None);
	return MakeShared<FJsonValueString>(ValueStr);
}

TSharedPtr<FJsonObject> FPropertySerializer::SerializePropertyOverrides(const UObject* Object)
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

		if (Property->Identical_InContainer(Object, CDO))
		{
			continue;
		}

		const void* ValuePtr = Property->ContainerPtrToValuePtr<void>(Object);
		const TSharedPtr<FJsonValue> JsonValue = SerializePropertyValue(Property, ValuePtr);
		if (JsonValue)
		{
			Overrides->SetField(Property->GetName(), JsonValue);
		}
	}

	return Overrides;
}

TArray<TSharedPtr<FJsonValue>> FPropertySerializer::SerializeUserProperties(
	const void* Container,
	const UClass* ContainerClass,
	const TArray<const UClass*>& SkipClasses)
{
	TArray<TSharedPtr<FJsonValue>> Properties;

	if (!Container || !ContainerClass)
	{
		return Properties;
	}

	for (TFieldIterator<FProperty> PropIt(ContainerClass); PropIt; ++PropIt)
	{
		FProperty* Property = *PropIt;
		const UClass* OwnerClass = Property->GetOwnerClass();

		if (OwnerClass && SkipClasses.Contains(OwnerClass))
		{
			continue;
		}

		if (Property->HasAnyPropertyFlags(CPF_Deprecated | CPF_Transient))
		{
			continue;
		}

		TSharedPtr<FJsonObject> PropObj = MakeShared<FJsonObject>();
		PropObj->SetStringField(TEXT("name"), Property->GetName());
		PropObj->SetStringField(TEXT("cppType"), Property->GetCPPType());

		const void* ValuePtr = Property->ContainerPtrToValuePtr<void>(Container);
		const TSharedPtr<FJsonValue> TypedValue = SerializePropertyValue(Property, ValuePtr);
		if (TypedValue)
		{
			PropObj->SetField(TEXT("value"), TypedValue);
		}

		if (const FObjectPropertyBase* ObjProp = CastField<FObjectPropertyBase>(Property))
		{
			if (const UObject* ReferencedObj = ObjProp->GetObjectPropertyValue(ValuePtr))
			{
				PropObj->SetStringField(TEXT("referencePath"), ReferencedObj->GetPathName());
			}
		}

		Properties.Add(MakeShared<FJsonValueObject>(PropObj));
	}

	return Properties;
}
