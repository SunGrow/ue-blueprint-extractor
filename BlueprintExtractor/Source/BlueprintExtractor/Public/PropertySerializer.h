#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"

class FProperty;
class UClass;
class UObject;

struct FPropertySerializer
{
	static TSharedPtr<FJsonValue> SerializePropertyValue(const FProperty* Property, const void* ValuePtr);
	static TSharedPtr<FJsonObject> SerializePropertyOverrides(const UObject* Object);
	static TArray<TSharedPtr<FJsonValue>> SerializeUserProperties(
		const void* Container,
		const UClass* ContainerClass,
		const TArray<const UClass*>& SkipClasses);
};
