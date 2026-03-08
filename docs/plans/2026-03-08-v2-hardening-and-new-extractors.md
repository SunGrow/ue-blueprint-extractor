# Blueprint Extractor v2.0 — Hardening & New Extractors

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix existing contract bugs, unify property serialization, and add 5 new extractor families (BehaviorTree, UserDefinedStruct/Enum, Curve, MaterialInstance, AnimAssets).

**Architecture:** Phase 1 fixes infrastructure issues (schema governance, typed serializer, contract bugs) so Phase 2 new extractors are built on a clean foundation. Each new extractor follows the proven pattern: `FooExtractor.h/.cpp` → `Library` method → `Subsystem` UFUNCTION → `MCP tool`. The typed property serializer is extracted from `WidgetTreeExtractor` into a shared utility, then used by all extractors for consistent JSON output.

**Tech Stack:** UE5 C++ (editor plugin), TypeScript/Node.js (MCP server), Zod (validation), MCP SDK

---

## Version Strategy

| After Phase | Plugin | MCP | Schema | Rationale |
|---|---|---|---|---|
| Phase 1 complete | 1.1 | 1.7.0 | 1.1.0 | Contract fixes + typed serialization = minor breaking change for downstream parsers (values change from strings to typed JSON). |
| Phase 2 complete | 1.2 | 1.8.0 | 1.2.0 | Additive: new asset types, new tools. No existing contracts broken. |

---

## Dependency Graph

```
Phase 1 (must be sequential within, parallel across independent tracks):

  1.1 Schema Version Constant ──┐
                                 ├──> 1.3 Migrate Existing Extractors
  1.2 Shared Typed Serializer ──┘

  1.4 Cascade Contract Fix ─────> 1.5 Cascade Filenames + Manifest

  1.6 Compile Diagnostics (independent)
  1.7 Search Scalability (independent)

Phase 2 (each extractor is independent, can be parallelized):

  Phase 1 complete ──┬──> 2.1 BehaviorTree + Blackboard
                     ├──> 2.2 UserDefinedStruct + UserDefinedEnum
                     ├──> 2.3 Curve + CurveTable
                     ├──> 2.4 Material Instances
                     └──> 2.5 Animation Assets
```

**Parallel tracks in Phase 1:**
- Track A: 1.1 → 1.2 → 1.3 (schema + serializer + migration)
- Track B: 1.4 → 1.5 (cascade fixes)
- Track C: 1.6 (compile diagnostics)
- Track D: 1.7 (search scalability)

Tracks B, C, D are independent of each other and of Track A. Track A must complete before Phase 2.

---

## File Reference

Files touched frequently across tasks:

| Shorthand | Full Path |
|---|---|
| **Subsystem.h** | `BlueprintExtractor/Source/BlueprintExtractor/Public/BlueprintExtractorSubsystem.h` |
| **Subsystem.cpp** | `BlueprintExtractor/Source/BlueprintExtractor/Private/BlueprintExtractorSubsystem.cpp` |
| **Library.h** | `BlueprintExtractor/Source/BlueprintExtractor/Public/BlueprintExtractorLibrary.h` |
| **Library.cpp** | `BlueprintExtractor/Source/BlueprintExtractor/Private/BlueprintExtractorLibrary.cpp` |
| **Build.cs** | `BlueprintExtractor/Source/BlueprintExtractor/BlueprintExtractor.Build.cs` |
| **MCP/index.ts** | `MCP/src/index.ts` |
| **MCP/ue-client.ts** | `MCP/src/ue-client.ts` |
| **MCP/compactor.ts** | `MCP/src/compactor.ts` |
| **MCP/package.json** | `MCP/package.json` |

---

# Phase 1: Infrastructure & Contract Fixes

## Task 1.1: Centralize Schema Version Constant

**Goal:** Replace 4 duplicated `"1.0.0"` string literals with one canonical constant.

**Files:**
- Create: `BlueprintExtractor/Source/BlueprintExtractor/Public/BlueprintExtractorVersion.h`
- Modify: `BlueprintExtractor/Source/BlueprintExtractor/Private/BlueprintExtractorLibrary.cpp:183`
- Modify: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/DataAssetExtractor.cpp:13`
- Modify: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/DataTableExtractor.cpp:13`
- Modify: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/StateTreeExtractor.cpp:18`

**Step 1: Create the version header**

```cpp
// BlueprintExtractorVersion.h
#pragma once

#include "CoreMinimal.h"

namespace BlueprintExtractor
{
	/** Canonical schema version for all JSON output. Bump on wire-shape changes:
	 *  - Patch: additive non-breaking fields
	 *  - Minor: additive structural changes, typed values where strings were
	 *  - Major: breaking renames, removals, restructured roots
	 */
	inline constexpr const TCHAR* SchemaVersion = TEXT("1.1.0");
}
```

**Step 2: Replace all 4 occurrences**

In each file, replace:
```cpp
Root->SetStringField(TEXT("schemaVersion"), TEXT("1.0.0"));
```
with:
```cpp
#include "BlueprintExtractorVersion.h"
// ...
Root->SetStringField(TEXT("schemaVersion"), BlueprintExtractor::SchemaVersion);
```

Files and lines:
- `BlueprintExtractorLibrary.cpp:183`
- `DataAssetExtractor.cpp:13`
- `DataTableExtractor.cpp:13`
- `StateTreeExtractor.cpp:18`

**Step 3: Verify build compiles**

Run: UE editor build or `UnrealBuildTool` for the plugin module.

**Step 4: Commit**

```
feat: centralize schema version constant (1.1.0)
```

---

## Task 1.2: Create Shared Typed Property Serializer

**Goal:** Extract `ExtractPropertyValue` from `WidgetTreeExtractor` into a shared utility, add container support (TArray, TSet, TMap), and make it the canonical property serializer for all extractors.

**Files:**
- Create: `BlueprintExtractor/Source/BlueprintExtractor/Public/PropertySerializer.h`
- Create: `BlueprintExtractor/Source/BlueprintExtractor/Private/PropertySerializer.cpp`
- Modify: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/WidgetTreeExtractor.h`
- Modify: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/WidgetTreeExtractor.cpp`

**Step 1: Create PropertySerializer.h**

```cpp
// PropertySerializer.h
#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"

/**
 * Shared typed property serializer. Converts FProperty values to JSON
 * preserving native types (bool, number, string, object, array, null).
 *
 * Handles: Bool, Int, Int64, Float, Double, String, Name, Text, Enum,
 * ByteEnum, Struct (via UStructToJsonObject), SoftClass, SoftObject,
 * Object references, Array, Set, Map containers.
 *
 * Fallback: ExportText_Direct for unrecognized types.
 */
struct FPropertySerializer
{
	/**
	 * Serialize a single property value to a JSON value.
	 * @param Property  The FProperty descriptor.
	 * @param ValuePtr  Pointer to the property's value in memory.
	 * @return JSON value, or nullptr on failure.
	 */
	static TSharedPtr<FJsonValue> SerializePropertyValue(const FProperty* Property, const void* ValuePtr);

	/**
	 * Serialize all non-default properties on an object (CDO-diff).
	 * Only includes properties with CPF_Edit or CPF_BlueprintVisible.
	 * @param Object  The object instance to inspect.
	 * @return JSON object with property name → typed value pairs.
	 */
	static TSharedPtr<FJsonObject> SerializePropertyOverrides(const UObject* Object);

	/**
	 * Serialize all user properties on a container, skipping properties
	 * owned by the specified base classes.
	 * @param Container       Pointer to the UObject/struct instance.
	 * @param ContainerClass  The UClass to iterate properties from.
	 * @param SkipClasses     Base classes whose properties should be skipped.
	 * @return Array of {name, cppType, value, [referencePath]} objects.
	 */
	static TArray<TSharedPtr<FJsonValue>> SerializeUserProperties(
		const void* Container,
		const UClass* ContainerClass,
		const TArray<const UClass*>& SkipClasses);
};
```

**Step 2: Create PropertySerializer.cpp**

Move the body of `FWidgetTreeExtractor::ExtractPropertyValue` (WidgetTreeExtractor.cpp:168-286) into `FPropertySerializer::SerializePropertyValue`, then add container handling:

```cpp
// PropertySerializer.cpp
#include "PropertySerializer.h"
#include "JsonObjectConverter.h"
#include "UObject/UnrealType.h"

TSharedPtr<FJsonValue> FPropertySerializer::SerializePropertyValue(const FProperty* Property, const void* ValuePtr)
{
	if (!Property || !ValuePtr)
	{
		return nullptr;
	}

	// === Scalar types (copied from WidgetTreeExtractor::ExtractPropertyValue) ===

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

	// Float/Double
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

	// Enum property
	if (const FEnumProperty* EnumProp = CastField<FEnumProperty>(Property))
	{
		const UEnum* Enum = EnumProp->GetEnum();
		if (Enum)
		{
			const FNumericProperty* UnderlyingProp = EnumProp->GetUnderlyingProperty();
			const int64 EnumValue = UnderlyingProp->GetSignedIntPropertyValue(ValuePtr);
			return MakeShared<FJsonValueString>(Enum->GetNameStringByValue(EnumValue));
		}
	}

	// ByteProperty with enum
	if (const FByteProperty* ByteProp = CastField<FByteProperty>(Property))
	{
		if (ByteProp->Enum)
		{
			const int64 EnumValue = static_cast<int64>(ByteProp->GetPropertyValue(ValuePtr));
			return MakeShared<FJsonValueString>(ByteProp->Enum->GetNameStringByValue(EnumValue));
		}
		// Plain byte without enum → numeric
		return MakeShared<FJsonValueNumber>(ByteProp->GetPropertyValue(ValuePtr));
	}

	// === Container types (NEW) ===

	// Array
	if (const FArrayProperty* ArrayProp = CastField<FArrayProperty>(Property))
	{
		TArray<TSharedPtr<FJsonValue>> JsonArray;
		FScriptArrayHelper ArrayHelper(ArrayProp, ValuePtr);
		for (int32 i = 0; i < ArrayHelper.Num(); ++i)
		{
			TSharedPtr<FJsonValue> ElemValue = SerializePropertyValue(
				ArrayProp->Inner, ArrayHelper.GetRawPtr(i));
			JsonArray.Add(ElemValue ? ElemValue : MakeShared<FJsonValueNull>());
		}
		return MakeShared<FJsonValueArray>(JsonArray);
	}

	// Set
	if (const FSetProperty* SetProp = CastField<FSetProperty>(Property))
	{
		TArray<TSharedPtr<FJsonValue>> JsonArray;
		FScriptSetHelper SetHelper(SetProp, ValuePtr);
		for (int32 i = 0; i < SetHelper.Num(); ++i)
		{
			if (SetHelper.IsValidIndex(i))
			{
				TSharedPtr<FJsonValue> ElemValue = SerializePropertyValue(
					SetProp->ElementProp, SetHelper.GetElementPtr(i));
				JsonArray.Add(ElemValue ? ElemValue : MakeShared<FJsonValueNull>());
			}
		}
		return MakeShared<FJsonValueArray>(JsonArray);
	}

	// Map
	if (const FMapProperty* MapProp = CastField<FMapProperty>(Property))
	{
		TSharedPtr<FJsonObject> JsonMap = MakeShared<FJsonObject>();
		FScriptMapHelper MapHelper(MapProp, ValuePtr);
		for (int32 i = 0; i < MapHelper.Num(); ++i)
		{
			if (MapHelper.IsValidIndex(i))
			{
				// Key must be stringifiable for JSON object keys
				FString KeyStr;
				MapProp->KeyProp->ExportText_Direct(KeyStr, MapHelper.GetKeyPtr(i), nullptr, nullptr, PPF_None);

				TSharedPtr<FJsonValue> ValJson = SerializePropertyValue(
					MapProp->ValueProp, MapHelper.GetValuePtr(i));
				JsonMap->SetField(KeyStr, ValJson ? ValJson : MakeShared<FJsonValueNull>());
			}
		}
		return MakeShared<FJsonValueObject>(JsonMap);
	}

	// === Reference types ===

	// Struct
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

	// Soft class (check before FSoftObjectProperty)
	if (CastField<FSoftClassProperty>(Property))
	{
		const FSoftObjectPtr& SoftPtr = *static_cast<const FSoftObjectPtr*>(ValuePtr);
		return MakeShared<FJsonValueString>(SoftPtr.ToSoftObjectPath().ToString());
	}

	// Soft object (check before FObjectPropertyBase)
	if (CastField<FSoftObjectProperty>(Property))
	{
		const FSoftObjectPtr& SoftPtr = *static_cast<const FSoftObjectPtr*>(ValuePtr);
		return MakeShared<FJsonValueString>(SoftPtr.ToSoftObjectPath().ToString());
	}

	// Object reference
	if (const FObjectPropertyBase* ObjProp = CastField<FObjectPropertyBase>(Property))
	{
		const UObject* ReferencedObject = ObjProp->GetObjectPropertyValue(ValuePtr);
		if (ReferencedObject)
		{
			return MakeShared<FJsonValueString>(ReferencedObject->GetPathName());
		}
		return MakeShared<FJsonValueNull>();
	}

	// === Fallback ===
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

		if (!Property->Identical_InContainer(Object, CDO))
		{
			const void* ValuePtr = Property->ContainerPtrToValuePtr<void>(Object);
			const TSharedPtr<FJsonValue> JsonValue = SerializePropertyValue(Property, ValuePtr);
			if (JsonValue)
			{
				Overrides->SetField(Property->GetName(), JsonValue);
			}
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

		// Skip properties owned by base classes
		const UClass* OwnerClass = Property->GetOwnerClass();
		if (SkipClasses.Contains(OwnerClass))
		{
			continue;
		}

		// Skip deprecated and transient
		if (Property->HasAnyPropertyFlags(CPF_Deprecated | CPF_Transient))
		{
			continue;
		}

		TSharedPtr<FJsonObject> PropObj = MakeShared<FJsonObject>();
		PropObj->SetStringField(TEXT("name"), Property->GetName());
		PropObj->SetStringField(TEXT("cppType"), Property->GetCPPType());

		const void* ValuePtr = Property->ContainerPtrToValuePtr<void>(Container);
		TSharedPtr<FJsonValue> TypedValue = SerializePropertyValue(Property, ValuePtr);
		if (TypedValue)
		{
			PropObj->SetField(TEXT("value"), TypedValue);
		}

		// For object references, also include the path separately for easy lookup
		if (const FObjectPropertyBase* ObjProp = CastField<FObjectPropertyBase>(Property))
		{
			const UObject* ReferencedObj = ObjProp->GetObjectPropertyValue(ValuePtr);
			if (ReferencedObj)
			{
				PropObj->SetStringField(TEXT("referencePath"), ReferencedObj->GetPathName());
			}
		}

		Properties.Add(MakeShared<FJsonValueObject>(PropObj));
	}

	return Properties;
}
```

**Step 3: Redirect WidgetTreeExtractor to use shared serializer**

In `WidgetTreeExtractor.h`, remove the private `ExtractPropertyValue` declaration.
In `WidgetTreeExtractor.cpp`:
- Remove `ExtractPropertyValue` method body (lines 168-286).
- Replace `ExtractPropertyOverrides` implementation (lines 133-166) to delegate:

```cpp
#include "PropertySerializer.h"

TSharedPtr<FJsonObject> FWidgetTreeExtractor::ExtractPropertyOverrides(const UObject* Object)
{
	return FPropertySerializer::SerializePropertyOverrides(Object);
}
```

- Update any remaining direct calls to `ExtractPropertyValue` within `WidgetTreeExtractor.cpp` to use `FPropertySerializer::SerializePropertyValue`.

**Step 4: Verify build compiles**

**Step 5: Commit**

```
feat: extract shared typed property serializer with container support
```

---

## Task 1.3: Migrate Existing Extractors to Typed Serializer

**Goal:** Replace `ExportText_InContainer` string serialization in DataAsset, DataTable, and Component extractors with the shared typed serializer.

**Depends on:** Task 1.1, Task 1.2

**Files:**
- Modify: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/DataAssetExtractor.cpp`
- Modify: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/DataTableExtractor.cpp`
- Modify: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/ComponentExtractor.cpp`

### Step 1: Migrate DataAssetExtractor

**Current** (DataAssetExtractor.cpp:25-66): Manual property iteration with `ExportText_InContainer`.

**Replace with:**

```cpp
#include "PropertySerializer.h"
#include "BlueprintExtractorVersion.h"

TSharedPtr<FJsonObject> FDataAssetExtractor::Extract(const UDataAsset* DataAsset)
{
	if (!ensureMsgf(DataAsset, TEXT("DataAssetExtractor: null DataAsset")))
	{
		return nullptr;
	}

	TSharedPtr<FJsonObject> Root = MakeShared<FJsonObject>();
	Root->SetStringField(TEXT("schemaVersion"), BlueprintExtractor::SchemaVersion);

	TSharedPtr<FJsonObject> DAObj = MakeShared<FJsonObject>();
	DAObj->SetStringField(TEXT("assetPath"), DataAsset->GetPathName());
	DAObj->SetStringField(TEXT("assetName"), DataAsset->GetName());
	DAObj->SetStringField(TEXT("dataAssetClass"), DataAsset->GetClass()->GetName());

	// Skip base class properties
	static const UClass* DataAssetBase        = UDataAsset::StaticClass();
	static const UClass* PrimaryDataAssetBase = FindObject<UClass>(nullptr, TEXT("/Script/Engine.PrimaryDataAsset"));
	static const UClass* ObjectBase           = UObject::StaticClass();

	TArray<const UClass*> SkipClasses = { DataAssetBase, ObjectBase };
	if (PrimaryDataAssetBase)
	{
		SkipClasses.Add(PrimaryDataAssetBase);
	}

	DAObj->SetArrayField(TEXT("properties"),
		FPropertySerializer::SerializeUserProperties(DataAsset, DataAsset->GetClass(), SkipClasses));

	Root->SetObjectField(TEXT("dataAsset"), DAObj);
	return Root;
}
```

**Wire-shape change:** Property `value` fields change from always-string to typed JSON (booleans become `true`/`false`, numbers become numeric, structs become objects, arrays become arrays). The `referencePath` field is still included for object properties. This is a **minor breaking change** for parsers that assumed string values.

### Step 2: Migrate DataTableExtractor

**Current** (DataTableExtractor.cpp:44-79): Row values serialized via `ExportText_InContainer`.

Modify the row-value loop to use `FPropertySerializer::SerializePropertyValue` instead of `ExportText_InContainer`:

```cpp
// For each row property value:
const void* ValuePtr = Property->ContainerPtrToValuePtr<void>(RowData);
TSharedPtr<FJsonValue> TypedValue = FPropertySerializer::SerializePropertyValue(Property, ValuePtr);
if (TypedValue)
{
	PropObj->SetField(TEXT("value"), TypedValue);
}
```

Also update the schema version to use `BlueprintExtractor::SchemaVersion`.

### Step 3: Migrate ComponentExtractor

**Current** (ComponentExtractor.cpp:84-114): Property overrides use `ExportText_InContainer`.

Replace `ExtractPropertyOverrides` to delegate:

```cpp
#include "PropertySerializer.h"

TSharedPtr<FJsonObject> FComponentExtractor::ExtractPropertyOverrides(const UActorComponent* ComponentTemplate)
{
	return FPropertySerializer::SerializePropertyOverrides(ComponentTemplate);
}
```

### Step 4: Verify build compiles

### Step 5: Commit

```
feat: migrate DataAsset/DataTable/Component extractors to typed JSON serialization
```

---

## Task 1.4: Fix extract_cascade Compact Contract

**Goal:** Remove `compact` from `extract_cascade` MCP tool contract (it was never implemented). Cascade writes files to disk where size is not an LLM concern. Users who need compacted data should extract individual assets with `compact=true`.

**Files:**
- Modify: `MCP/src/index.ts:254-309` (remove compact parameter from extract_cascade)

### Step 1: Remove compact from extract_cascade Zod schema

In `MCP/src/index.ts`, find the `extract_cascade` tool definition (around line 254). Remove the `compact` property from the input schema and its description. Remove it from the destructured parameters in the handler.

**Before:**
```typescript
compact: z.boolean().optional().default(false)
  .describe('...compact mode...'),
```

**After:** (line removed entirely)

Also remove `compact` from the handler parameter destructuring and any usage.

### Step 2: Update tool description

Update the tool description text to clarify that cascade writes files to disk and compact mode is available via `extract_blueprint` for individual assets.

### Step 3: Build MCP

Run: `cd MCP && npm run build`
Expected: Clean compilation.

### Step 4: Commit

```
fix: remove non-functional compact parameter from extract_cascade
```

---

## Task 1.5: Fix Cascade Filename Collisions + Add Manifest

**Goal:** (A) Make cascade output filenames collision-proof by incorporating the asset path. (B) Return a per-asset manifest so callers know which file maps to which asset.

**Files:**
- Modify: `BlueprintExtractor/Source/BlueprintExtractor/Private/BlueprintExtractorLibrary.h:48-50` (change return type)
- Modify: `BlueprintExtractor/Source/BlueprintExtractor/Private/BlueprintExtractorLibrary.cpp:659-748` (filename logic + manifest)
- Modify: `BlueprintExtractor/Source/BlueprintExtractor/Private/BlueprintExtractorSubsystem.cpp:126-196` (return manifest)
- Modify: `MCP/src/index.ts:254-309` (display manifest in response)

### Step 1: Design collision-proof filename strategy

Convert asset path to a filesystem-safe filename:
- `/Game/Characters/Hero/BP_Hero` → `Characters--Hero--BP_Hero.json`
- `/Game/Characters/Enemy/BP_Hero` → `Characters--Enemy--BP_Hero.json`

Strategy: strip `/Game/` prefix, replace `/` with `--`, append `.json`. This preserves path uniqueness while staying filesystem-safe.

### Step 2: Define manifest item struct

Change `ExtractWithCascade` to return a JSON array manifest instead of just an int count.

In **Library.h**, change signature:

```cpp
// Old:
static int32 ExtractWithCascade(...);

// New:
static TSharedPtr<FJsonObject> ExtractWithCascade(
    const TArray<UObject*>& InitialAssets,
    const FString& OutputDir,
    EBlueprintExtractionScope Scope,
    int32 MaxDepth,
    const TArray<FName>& GraphFilter = {});
```

Return shape:
```json
{
  "extracted_count": 5,
  "skipped_count": 1,
  "output_directory": "/absolute/path",
  "assets": [
    {
      "asset_path": "/Game/Characters/Hero/BP_Hero",
      "asset_type": "Blueprint",
      "output_file": "Characters--Hero--BP_Hero.json",
      "depth": 0,
      "status": "extracted"
    },
    {
      "asset_path": "/Game/Invalid/Asset",
      "asset_type": "Unknown",
      "depth": 0,
      "status": "skipped",
      "error": "Failed to load asset"
    }
  ]
}
```

### Step 3: Update Library.cpp ExtractWithCascade

In `BlueprintExtractorLibrary.cpp:659-748`:

```cpp
TSharedPtr<FJsonObject> UBlueprintExtractorLibrary::ExtractWithCascade(
    const TArray<UObject*>& InitialAssets,
    const FString& OutputDir,
    EBlueprintExtractionScope Scope,
    int32 MaxDepth,
    const TArray<FName>& GraphFilter)
{
    // ... (existing BFS setup) ...

    TArray<TSharedPtr<FJsonValue>> ManifestArray;

    while (ProcessIndex < Queue.Num())
    {
        FPendingAsset Current = Queue[ProcessIndex++];

        // Path-safe filename: strip /Game/ prefix, replace / with --
        FString AssetPath = Current.Asset->GetPathName();
        FString SafeName = AssetPath;
        SafeName.RemoveFromStart(TEXT("/Game/"));
        SafeName.ReplaceInline(TEXT("/"), TEXT("--"));
        SafeName += TEXT(".json");

        const FString FullPath = OutputDir / SafeName;

        TSharedPtr<FJsonObject> ManifestItem = MakeShared<FJsonObject>();
        ManifestItem->SetStringField(TEXT("assetPath"), AssetPath);
        ManifestItem->SetStringField(TEXT("outputFile"), SafeName);
        ManifestItem->SetNumberField(TEXT("depth"), Current.Depth);

        bool bSuccess = false;
        FString AssetType;
        TArray<FSoftObjectPath> Refs;

        if (UBlueprint* BP = Cast<UBlueprint>(Current.Asset))
        {
            AssetType = TEXT("Blueprint");
            bSuccess = ExtractBlueprintToJson(BP, FullPath, Scope, GraphFilter);
            if (Current.Depth < MaxDepth)
            {
                Refs = CollectBlueprintReferences(BP);
            }
        }
        else if (UStateTree* ST = Cast<UStateTree>(Current.Asset))
        {
            AssetType = TEXT("StateTree");
            bSuccess = ExtractStateTreeToJson(ST, FullPath);
            if (Current.Depth < MaxDepth)
            {
                Refs = CollectStateTreeReferences(ST);
            }
        }
        else if (UDataAsset* DA = Cast<UDataAsset>(Current.Asset))
        {
            AssetType = TEXT("DataAsset");
            bSuccess = ExtractDataAssetToJson(DA, FullPath);
        }
        else if (UDataTable* DT = Cast<UDataTable>(Current.Asset))
        {
            AssetType = TEXT("DataTable");
            bSuccess = ExtractDataTableToJson(DT, FullPath);
        }

        ManifestItem->SetStringField(TEXT("assetType"), AssetType);
        ManifestItem->SetStringField(TEXT("status"), bSuccess ? TEXT("extracted") : TEXT("failed"));

        if (bSuccess)
        {
            SuccessCount++;
        }

        ManifestArray.Add(MakeShared<FJsonValueObject>(ManifestItem));

        // ... (existing reference enqueueing) ...
    }

    TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
    Result->SetNumberField(TEXT("extracted_count"), SuccessCount);
    Result->SetNumberField(TEXT("total_count"), ManifestArray.Num());
    Result->SetArrayField(TEXT("assets"), ManifestArray);
    return Result;
}
```

### Step 4: Update Subsystem.cpp to forward manifest

In `BlueprintExtractorSubsystem.cpp:126-196`, update to use the new return type:

```cpp
TSharedPtr<FJsonObject> ResultObj = UBlueprintExtractorLibrary::ExtractWithCascade(
    LoadedAssets, OutputDir, ParsedScope, MaxDepth, ParsedFilter);

if (!ResultObj)
{
    return MakeErrorJson(TEXT("Cascade extraction failed"));
}

ResultObj->SetStringField(TEXT("output_directory"), AbsOutputDir);

FString OutString;
const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutString);
FJsonSerializer::Serialize(ResultObj.ToSharedRef(), Writer);
return OutString;
```

### Step 5: Update MCP tool response

In `MCP/src/index.ts`, update the `extract_cascade` handler to display the manifest:

```typescript
const parsed = JSON.parse(result);
if (parsed.error) {
    return { content: [{ type: 'text', text: `Error: ${parsed.error}` }], isError: true };
}

const summary = [
    `Extracted ${parsed.extracted_count}/${parsed.total_count} assets to ${parsed.output_directory}`,
    '',
    '| Asset | Type | Depth | File | Status |',
    '|-------|------|-------|------|--------|',
    ...(parsed.assets || []).map((a: any) =>
        `| ${a.assetPath} | ${a.assetType} | ${a.depth} | ${a.outputFile} | ${a.status} |`
    ),
].join('\n');

return { content: [{ type: 'text', text: summary }] };
```

### Step 6: Build MCP + verify UE compiles

### Step 7: Commit

```
feat: collision-proof cascade filenames and per-asset manifest
```

**Risk note:** This changes the cascade output filename convention. Any existing scripts that read cascade output by `<AssetName>.json` will need to update to the new `Path--To--AssetName.json` pattern. The manifest makes this discoverable.

---

## Task 1.6: Upgrade compile_widget_blueprint Diagnostics

**Goal:** Replace the hard-coded `WarningCount = 0` with actual compiler message collection. Return real warnings and errors from the Blueprint compiler.

**Files:**
- Modify: `BlueprintExtractor/Source/BlueprintExtractor/Private/Builders/WidgetTreeBuilder.cpp:303-369`

### Step 1: Research compile message access

The Blueprint compiler logs messages to `FCompilerResultsLog`. After `FKismetEditorUtilities::CompileBlueprint`, messages are accessible via `WidgetBP->CompileLog` (a `FCompilerResultsLog` member added in UE5) or by checking `GLog` message capture.

**Preferred approach:** After compile, iterate the Blueprint's `Message_Log` if available. Otherwise, use `FMessageLog("BlueprintLog")` to query recent messages. The most reliable approach is to check the `UBlueprint::Message_Log` member which is populated by the compiler.

**Simpler reliable approach:** Use `FKismetEditorUtilities::CompileBlueprint` with the `pResults` parameter variant, or inspect `WidgetBP->ErrorMsg` / `WidgetBP->CurrentMessageLog` after compile.

**Safest approach for UE 5.6+:** Register a `FMessageLog` listener before compile, capture messages, unregister after.

### Step 2: Implement real diagnostics collection

Replace the compile result section (WidgetTreeBuilder.cpp:348-369):

```cpp
// Collect compile messages from the Blueprint's message log
TArray<TSharedPtr<FJsonValue>> ErrorArray;
TArray<TSharedPtr<FJsonValue>> WarningArray;
int32 ErrorCount = 0;
int32 WarningCount = 0;

// Check for generated class as a basic sanity check
if (!WidgetBP->GeneratedClass && !bSuccess)
{
    TSharedPtr<FJsonObject> Msg = MakeShared<FJsonObject>();
    Msg->SetStringField(TEXT("severity"), TEXT("Error"));
    Msg->SetStringField(TEXT("message"), TEXT("GeneratedClass is null after compilation"));
    ErrorArray.Add(MakeShared<FJsonValueObject>(Msg));
    ErrorCount++;
}

// Collect messages from FKismetCompilerContext via the Blueprint's log
if (WidgetBP->CurrentMessageLog.IsValid())
{
    // The message log contains FTokenizedMessage entries
    for (const TSharedRef<FTokenizedMessage>& Message : WidgetBP->CurrentMessageLog->GetMessages())
    {
        const EMessageSeverity::Type Severity = Message->GetSeverity();
        TSharedPtr<FJsonObject> Msg = MakeShared<FJsonObject>();

        switch (Severity)
        {
        case EMessageSeverity::Error:
        case EMessageSeverity::CriticalError:
            Msg->SetStringField(TEXT("severity"), TEXT("Error"));
            Msg->SetStringField(TEXT("message"), Message->ToText().ToString());
            ErrorArray.Add(MakeShared<FJsonValueObject>(Msg));
            ErrorCount++;
            break;
        case EMessageSeverity::Warning:
        case EMessageSeverity::PerformanceWarning:
            Msg->SetStringField(TEXT("severity"), TEXT("Warning"));
            Msg->SetStringField(TEXT("message"), Message->ToText().ToString());
            WarningArray.Add(MakeShared<FJsonValueObject>(Msg));
            WarningCount++;
            break;
        default:
            break;
        }
    }
}

// Also infer from status
if (Status == BS_UpToDateWithWarnings && WarningCount == 0)
{
    TSharedPtr<FJsonObject> Msg = MakeShared<FJsonObject>();
    Msg->SetStringField(TEXT("severity"), TEXT("Warning"));
    Msg->SetStringField(TEXT("message"), TEXT("Blueprint compiled with warnings (details unavailable)"));
    WarningArray.Add(MakeShared<FJsonValueObject>(Msg));
    WarningCount++;
}

const TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
Result->SetBoolField(TEXT("success"), bSuccess);
Result->SetStringField(TEXT("status"), StatusString);

// Combine errors and warnings into one messages array
TArray<TSharedPtr<FJsonValue>> AllMessages;
AllMessages.Append(ErrorArray);
AllMessages.Append(WarningArray);
Result->SetArrayField(TEXT("messages"), AllMessages);
Result->SetNumberField(TEXT("errorCount"), ErrorCount);
Result->SetNumberField(TEXT("warningCount"), WarningCount);
return Result;
```

**Risk note:** The exact compile message access API varies between UE versions. `CurrentMessageLog` may not exist in all UE5 versions. The implementation should be tested against UE 5.6 and 5.7. If `CurrentMessageLog` is not available, fall back to the `BS_UpToDateWithWarnings` status check as a degraded-but-honest approach. The key improvement is that `warningCount` is no longer hard-coded to 0.

**Alternative approach if CurrentMessageLog is unavailable:** Capture `GLog` output during compile:

```cpp
// Before compile:
FOutputDevice* OldLog = GLog;
FBufferedOutputDevice CaptureLog;
GLog = &CaptureLog;

FKismetEditorUtilities::CompileBlueprint(WidgetBP);

GLog = OldLog;

// Parse CaptureLog for warnings/errors
```

This is more invasive but guaranteed to work. Research the exact API available in your target UE versions before implementing.

### Step 3: Update MCP tool response (optional)

In `MCP/src/index.ts`, the `compile_widget_blueprint` handler already returns the full JSON. The new `messages` array with `{severity, message}` objects will pass through automatically. Consider adding a human-readable summary:

```typescript
const text = JSON.stringify(parsed, null, 2);
return { content: [{ type: 'text', text }] };
```

### Step 4: Verify build compiles + test with a WidgetBlueprint with intentional errors

### Step 5: Commit

```
fix: collect real compile warnings/errors in compile_widget_blueprint
```

---

## Task 1.7: Improve search_assets Scalability

**Goal:** Replace `GetAllAssets` with filtered asset registry queries and add an optional result limit.

**Files:**
- Modify: `BlueprintExtractor/Source/BlueprintExtractor/Public/BlueprintExtractorSubsystem.h` (add MaxResults param)
- Modify: `BlueprintExtractor/Source/BlueprintExtractor/Private/BlueprintExtractorSubsystem.cpp:198-226`
- Modify: `MCP/src/index.ts:312-352` (add max_results parameter)

### Step 1: Update subsystem signature

In **Subsystem.h**, update `SearchAssets`:

```cpp
UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
FString SearchAssets(const FString& Query, const FString& ClassFilter = TEXT("Blueprint"), const int32 MaxResults = 100);
```

### Step 2: Replace GetAllAssets with filtered query

In **Subsystem.cpp**, replace the search implementation:

```cpp
FString UBlueprintExtractorSubsystem::SearchAssets(const FString& Query, const FString& ClassFilter, const int32 MaxResults)
{
    IAssetRegistry& AssetRegistry = *IAssetRegistry::Get();

    // Build asset registry filter
    FARFilter Filter;
    Filter.bRecursivePaths = true;
    Filter.bRecursiveClasses = true;
    Filter.PackagePaths.Add(FName(TEXT("/Game")));

    // Apply class filter if specified
    if (!ClassFilter.IsEmpty())
    {
        Filter.ClassPaths.Add(FTopLevelAssetPath(TEXT("/Script/Engine"), FName(*ClassFilter)));
    }

    TArray<FAssetData> AssetDatas;
    AssetRegistry.GetAssets(Filter, AssetDatas);

    TArray<TSharedPtr<FJsonValue>> ResultArray;
    const int32 EffectiveLimit = (MaxResults > 0) ? MaxResults : 100;

    for (const FAssetData& AssetData : AssetDatas)
    {
        if (ResultArray.Num() >= EffectiveLimit)
        {
            break;
        }

        const FString AssetName = AssetData.AssetName.ToString();

        // Name filter
        if (!Query.IsEmpty() && !AssetName.Contains(Query))
        {
            continue;
        }

        TSharedPtr<FJsonObject> AssetObj = MakeShared<FJsonObject>();
        AssetObj->SetStringField(TEXT("path"), AssetData.GetObjectPathString());
        AssetObj->SetStringField(TEXT("name"), AssetName);
        AssetObj->SetStringField(TEXT("class"), AssetData.AssetClassPath.GetAssetName().ToString());
        ResultArray.Add(MakeShared<FJsonValueObject>(AssetObj));
    }

    // ... serialize ResultArray to JSON string ...
}
```

**Important consideration:** The `FARFilter.ClassPaths` field uses `FTopLevelAssetPath`. For Blueprint subclasses, the class path is `/Script/Engine.Blueprint`, not the Blueprint's own class. The `bRecursiveClasses = true` flag ensures subclasses (AnimBlueprint, WidgetBlueprint) are included when filtering for "Blueprint".

**Alternative if FTopLevelAssetPath doesn't match correctly:** Keep the name-based class filter as a post-filter but use `FARFilter.PackagePaths` to narrow the registry query to `/Game/` only, avoiding scanning engine/plugin content. This is still much faster than `GetAllAssets`.

### Step 3: Update MCP tool

In `MCP/src/index.ts`, add `max_results` parameter to the `search_assets` tool:

```typescript
max_results: z.number().optional().default(100)
    .describe('Maximum number of results to return (default 100)'),
```

Pass it through:
```typescript
const result = await client.callSubsystem('SearchAssets', {
    Query: query,
    ClassFilter: class_filter,
    MaxResults: max_results,
});
```

### Step 4: Build MCP + verify UE compiles

### Step 5: Commit

```
perf: replace GetAllAssets with filtered registry query, add result limit
```

---

## Phase 1 Completion Checkpoint

After all Phase 1 tasks:

1. **Verify:** All 4 schema version references use `BlueprintExtractor::SchemaVersion`
2. **Verify:** DataAsset, DataTable, Component extractors output typed JSON values
3. **Verify:** extract_cascade no longer accepts `compact`
4. **Verify:** Cascade files use path-safe names, response includes manifest
5. **Verify:** compile_widget_blueprint reports real warnings
6. **Verify:** search_assets uses filtered registry query with result limit
7. **Version bump:** Plugin → 1.1, MCP → 1.7.0, Schema → 1.1.0
8. **Update README:** Document typed property changes, cascade manifest, search limit
9. **Commit:** `release: v1.7.0 — contract fixes, typed serialization, cascade manifest`

---

# Phase 2: New Extractors

Each task in Phase 2 follows the same 5-layer pattern:

1. **Extractor class** — `FooExtractor.h/.cpp` in `Private/Extractors/`
2. **Library methods** — `ExtractFooToJson()` + `ExtractFooToJsonObject()` in Library
3. **Subsystem UFUNCTION** — `ExtractFoo()` in Subsystem (HTTP-callable)
4. **MCP tool** — `extract_foo` in `MCP/src/index.ts`
5. **Cascade integration** — Add to `ExtractWithCascade` BFS loop if the asset type can contain references to other extractable assets

New extractors MUST use:
- `BlueprintExtractor::SchemaVersion` for schema version
- `FPropertySerializer::SerializePropertyValue` for typed property values
- `FPropertySerializer::SerializeUserProperties` for bulk property export

---

## Task 2.1: BehaviorTree + Blackboard Extraction

**Goal:** Add `extract_behavior_tree` and `extract_blackboard` MCP tools.

**Files:**
- Modify: `BlueprintExtractor/Source/BlueprintExtractor/BlueprintExtractor.Build.cs` (add AIModule dependency)
- Create: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/BehaviorTreeExtractor.h`
- Create: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/BehaviorTreeExtractor.cpp`
- Create: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/BlackboardExtractor.h`
- Create: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/BlackboardExtractor.cpp`
- Modify: **Library.h** (add ExtractBehaviorTree/Blackboard methods)
- Modify: **Library.cpp** (implement methods + cascade integration)
- Modify: **Subsystem.h** (add UFUNCTIONs)
- Modify: **Subsystem.cpp** (add route handlers)
- Modify: **MCP/index.ts** (add 2 tools)

### Step 1: Add AIModule dependency

In `BlueprintExtractor.Build.cs`, add to `PrivateDependencyModuleNames`:
```csharp
"AIModule",
```

### Step 2: Design BehaviorTree JSON schema

```json
{
  "schemaVersion": "1.2.0",
  "behaviorTree": {
    "assetPath": "/Game/AI/BT_MainAI",
    "assetName": "BT_MainAI",
    "blackboardAsset": "/Game/AI/BB_MainAI",
    "rootNode": {
      "nodeClass": "BTComposite_Selector",
      "nodeName": "Root",
      "nodeIndex": 0,
      "decorators": [
        {
          "nodeClass": "BTDecorator_Blackboard",
          "nodeName": "IsAlive",
          "nodeIndex": 1,
          "properties": { "BlackboardKey": { "SelectedKeyName": "IsAlive" } }
        }
      ],
      "services": [
        {
          "nodeClass": "BTService_DefaultFocus",
          "nodeName": "SetFocus",
          "nodeIndex": 2,
          "properties": { ... }
        }
      ],
      "children": [
        {
          "nodeClass": "BTTask_MoveTo",
          "nodeName": "MoveToTarget",
          "nodeIndex": 3,
          "decorators": [],
          "services": [],
          "properties": { "AcceptableRadius": 50.0 }
        }
      ]
    }
  }
}
```

### Step 3: Create BehaviorTreeExtractor

```cpp
// BehaviorTreeExtractor.h
#pragma once
#include "CoreMinimal.h"
#include "Dom/JsonObject.h"

class UBehaviorTree;
class UBTNode;
class UBTCompositeNode;

struct FBehaviorTreeExtractor
{
    static TSharedPtr<FJsonObject> Extract(const UBehaviorTree* BehaviorTree);

private:
    static TSharedPtr<FJsonObject> ExtractNode(const UBTNode* Node, int32& NodeIndex);
    static TSharedPtr<FJsonObject> ExtractCompositeNode(const UBTCompositeNode* CompositeNode, int32& NodeIndex);
    static TArray<TSharedPtr<FJsonValue>> ExtractDecorators(const UBTNode* Node, int32& NodeIndex);
    static TArray<TSharedPtr<FJsonValue>> ExtractServices(const UBTCompositeNode* CompositeNode, int32& NodeIndex);
};
```

Implementation approach:
- `UBehaviorTree::RootNode` is the entry point (a `UBTCompositeNode`)
- Each `UBTCompositeNode` has `Children` (array of `FBTCompositeChild`)
- Each `FBTCompositeChild` has `ChildComposite` or `ChildTask`, plus `Decorators` array
- Each node has `Decorators` and composite nodes have `Services`
- Use `FPropertySerializer::SerializePropertyOverrides` for node properties
- Extract `BlackboardAsset` reference from `UBehaviorTree::BlackboardAsset`

**Key UE API calls:**
```cpp
BehaviorTree->RootNode                          // UBTCompositeNode*
BehaviorTree->BlackboardAsset                   // UBlackboardData*
CompositeNode->Children                         // TArray<FBTCompositeChild>
Child.ChildComposite / Child.ChildTask          // UBTCompositeNode* / UBTTaskNode*
Child.Decorators                                // TArray<UBTDecorator*>
CompositeNode->Services                         // TArray<UBTService*>
Node->GetNodeName()                             // FString
Node->NodeName                                  // FString
```

### Step 4: Create BlackboardExtractor

```cpp
// BlackboardExtractor.h
#pragma once
#include "CoreMinimal.h"
#include "Dom/JsonObject.h"

class UBlackboardData;

struct FBlackboardExtractor
{
    static TSharedPtr<FJsonObject> Extract(const UBlackboardData* BlackboardData);
};
```

JSON schema:
```json
{
  "schemaVersion": "1.2.0",
  "blackboard": {
    "assetPath": "/Game/AI/BB_MainAI",
    "assetName": "BB_MainAI",
    "parentBlackboard": "/Game/AI/BB_Base",
    "keys": [
      {
        "entryName": "TargetActor",
        "keyType": "BlackboardKeyType_Object",
        "baseClass": "Actor",
        "isInstanceSynced": false
      }
    ]
  }
}
```

Implementation approach:
- `UBlackboardData::Keys` is a `TArray<FBlackboardEntry>`
- Each entry has: `EntryName` (FName), `KeyType` (UBlackboardKeyType*), `bInstanceSynced` (bool)
- `UBlackboardData::Parent` references a parent BlackboardData (for inheritance)
- Key type subclasses: `UBlackboardKeyType_Bool`, `_Class`, `_Enum`, `_Float`, `_Int`, `_Name`, `_NativeEnum`, `_Object`, `_Rotator`, `_String`, `_Vector`
- For `_Object` and `_Class` key types, extract the `BaseClass` property

### Step 5: Add Library methods

In **Library.h**:
```cpp
static bool ExtractBehaviorTreeToJson(UBehaviorTree* BehaviorTree, const FString& OutputPath);
static TSharedPtr<FJsonObject> ExtractBehaviorTreeToJsonObject(UBehaviorTree* BehaviorTree);

static bool ExtractBlackboardToJson(UBlackboardData* Blackboard, const FString& OutputPath);
static TSharedPtr<FJsonObject> ExtractBlackboardToJsonObject(UBlackboardData* Blackboard);
```

In **Library.cpp**, implement following the same pattern as StateTree/DataAsset/DataTable.

### Step 6: Add Subsystem UFUNCTIONs

In **Subsystem.h**:
```cpp
UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
FString ExtractBehaviorTree(const FString& AssetPath);

UFUNCTION(BlueprintCallable, Category="Blueprint Extractor")
FString ExtractBlackboard(const FString& AssetPath);
```

In **Subsystem.cpp**, implement following the same pattern as ExtractStateTree.

### Step 7: Add cascade integration

In **Library.cpp** `ExtractWithCascade`:
- Add `UBehaviorTree` to the asset type detection chain (after UStateTree)
- Add `UBlackboardData` to the chain (after UBehaviorTree)
- Add `CollectBehaviorTreeReferences` that extracts:
  - BlackboardAsset reference
  - Blueprint-based task/decorator/service classes (via ClassGeneratedBy)

```cpp
// In the BFS loop:
else if (UBehaviorTree* BT = Cast<UBehaviorTree>(Current.Asset))
{
    AssetType = TEXT("BehaviorTree");
    bSuccess = ExtractBehaviorTreeToJson(BT, FullPath);
    if (Current.Depth < MaxDepth)
    {
        Refs = CollectBehaviorTreeReferences(BT);
    }
}
else if (UBlackboardData* BB = Cast<UBlackboardData>(Current.Asset))
{
    AssetType = TEXT("Blackboard");
    bSuccess = ExtractBlackboardToJson(BB, FullPath);
    // Blackboards can reference parent blackboards
    if (Current.Depth < MaxDepth && BB->Parent)
    {
        Refs.AddUnique(FSoftObjectPath(BB->Parent));
    }
}
```

Also add to the reference enqueue filter (Library.cpp line 743):
```cpp
if (RefAsset && (Cast<UBlueprint>(RefAsset) || Cast<UStateTree>(RefAsset) ||
    Cast<UBehaviorTree>(RefAsset) || Cast<UBlackboardData>(RefAsset)))
```

### Step 8: Add MCP tools

In **MCP/index.ts**, add two tools following the `extract_statetree` pattern:

```typescript
server.tool(
    'extract_behavior_tree',
    'Extract a BehaviorTree asset to structured JSON (node hierarchy, decorators, services, properties, blackboard reference)',
    {
        asset_path: z.string()
            .describe('Full UE content path to the BehaviorTree asset (e.g. /Game/AI/BT_MainAI)'),
    },
    { readOnlyHint: true, idempotentHint: true },
    async ({ asset_path }) => {
        const result = await client.callSubsystem('ExtractBehaviorTree', { AssetPath: asset_path });
        const parsed = JSON.parse(result);
        if (parsed.error) return { content: [{ type: 'text', text: `Error: ${parsed.error}` }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
    }
);
```

Similarly for `extract_blackboard`.

### Step 9: Build MCP + verify UE compiles

### Step 10: Commit

```
feat: add BehaviorTree and Blackboard extraction (extract_behavior_tree, extract_blackboard)
```

---

## Task 2.2: UserDefinedStruct + UserDefinedEnum Extraction

**Goal:** Add `extract_user_defined_struct` and `extract_user_defined_enum` MCP tools.

**Files:**
- Create: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/UserDefinedStructExtractor.h`
- Create: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/UserDefinedStructExtractor.cpp`
- Create: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/UserDefinedEnumExtractor.h`
- Create: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/UserDefinedEnumExtractor.cpp`
- Modify: **Library.h** / **Library.cpp**
- Modify: **Subsystem.h** / **Subsystem.cpp**
- Modify: **MCP/index.ts**

### Step 1: Design UserDefinedStruct JSON schema

```json
{
  "schemaVersion": "1.2.0",
  "userDefinedStruct": {
    "assetPath": "/Game/Data/S_ItemData",
    "assetName": "S_ItemData",
    "structGuid": "...",
    "status": "UpToDate",
    "fields": [
      {
        "name": "ItemName",
        "cppType": "FText",
        "category": "Default",
        "defaultValue": "Unnamed Item",
        "guid": "...",
        "tooltip": "Display name of the item"
      }
    ]
  }
}
```

### Step 2: Create UserDefinedStructExtractor

Implementation approach:
- `UUserDefinedStruct` inherits from `UScriptStruct`
- Fields are accessed via `UUserDefinedStruct::FieldNotify` or `FStructureEditorUtils::GetVarDesc`
- `FStructVariableDescription` entries contain: VarName, FriendlyName, VarGuid, Category, ToolTip, DefaultValue, SubCategoryObject, PinCategory
- Use `FPropertySerializer::SerializePropertyValue` for default values
- Status via `UUserDefinedStruct::Status` (EUserDefinedStructureStatus)

**Key UE API calls:**
```cpp
#include "UserDefinedStruct/UserDefinedStructEditorData.h"  // or FStructureEditorUtils
#include "Engine/UserDefinedStruct.h"

// Get variable descriptions:
const TArray<FStructVariableDescription>& VarDescs =
    FStructureEditorUtils::GetVarDesc(const_cast<UUserDefinedStruct*>(Struct));

// Each FStructVariableDescription:
Desc.VarName      // FName
Desc.FriendlyName // FString
Desc.VarGuid      // FGuid
Desc.Category     // FText
Desc.ToolTip      // FString
Desc.PinCategory  // FName (for pin type info)
Desc.SubCategoryObject // TObjectPtr<UObject>
Desc.DefaultValue // FString (exported text)
```

### Step 3: Design UserDefinedEnum JSON schema

```json
{
  "schemaVersion": "1.2.0",
  "userDefinedEnum": {
    "assetPath": "/Game/Data/E_ItemRarity",
    "assetName": "E_ItemRarity",
    "cppType": "E_ItemRarity",
    "entries": [
      { "name": "Common", "displayName": "Common", "value": 0 },
      { "name": "Rare", "displayName": "Rare", "value": 1 },
      { "name": "Legendary", "displayName": "Legendary", "value": 2 }
    ]
  }
}
```

### Step 4: Create UserDefinedEnumExtractor

Implementation approach:
- `UUserDefinedEnum` inherits from `UEnum`
- Entries via `Enum->NumEnums()` and `Enum->GetNameByIndex(i)`
- Display names via `UUserDefinedEnum::GetDisplayNameTextByIndex(i)` or `DisplayNameMap`
- Values via `Enum->GetValueByIndex(i)`

**Key UE API calls:**
```cpp
#include "Engine/UserDefinedEnum.h"

UDE->NumEnums()                                    // int32 (includes MAX entry)
UDE->GetNameByIndex(i)                             // FName
UDE->GetDisplayNameTextByIndex(i)                  // FText
UDE->GetValueByIndex(i)                            // int64
```

Note: The last entry is typically the auto-generated `_MAX` entry. Skip it (check `i < Enum->NumEnums() - 1`).

### Step 5: Add Library + Subsystem + MCP (same pattern as Task 2.1)

### Step 6: Cascade integration

UserDefinedStructs and UserDefinedEnums don't typically reference other extractable assets, so cascade integration is minimal. However, add them to the cascade asset loading chain so they can be targets:

```cpp
else if (UUserDefinedStruct* UDS = Cast<UUserDefinedStruct>(Current.Asset))
{
    AssetType = TEXT("UserDefinedStruct");
    bSuccess = ExtractUserDefinedStructToJson(UDS, FullPath);
}
else if (UUserDefinedEnum* UDE = Cast<UUserDefinedEnum>(Current.Asset))
{
    AssetType = TEXT("UserDefinedEnum");
    bSuccess = ExtractUserDefinedEnumToJson(UDE, FullPath);
}
```

### Step 7: Build + verify + commit

```
feat: add UserDefinedStruct and UserDefinedEnum extraction
```

---

## Task 2.3: Curve + CurveTable Extraction

**Goal:** Add `extract_curve` and `extract_curvetable` MCP tools. Reuse the curve key serialization pattern from `TimelineExtractor`.

**Files:**
- Create: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/CurveExtractor.h`
- Create: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/CurveExtractor.cpp`
- Create: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/CurveTableExtractor.h`
- Create: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/CurveTableExtractor.cpp`
- Modify: **Library.h** / **Library.cpp**
- Modify: **Subsystem.h** / **Subsystem.cpp**
- Modify: **MCP/index.ts**

### Step 1: Design Curve JSON schema

```json
{
  "schemaVersion": "1.2.0",
  "curve": {
    "assetPath": "/Game/Data/C_DamageOverTime",
    "assetName": "C_DamageOverTime",
    "curveType": "Float",
    "channels": {
      "default": {
        "keys": [
          { "time": 0.0, "value": 0.0, "arriveTangent": 0.0, "leaveTangent": 0.0, "interpMode": "Cubic" },
          { "time": 1.0, "value": 100.0, "arriveTangent": 0.0, "leaveTangent": 0.0, "interpMode": "Cubic" }
        ],
        "defaultValue": 3.402823e+38,
        "preInfinityExtrap": "Constant",
        "postInfinityExtrap": "Constant"
      }
    }
  }
}
```

For `UCurveVector`, channels are `{ "x": {...}, "y": {...}, "z": {...} }`.
For `UCurveLinearColor`, channels are `{ "r": {...}, "g": {...}, "b": {...}, "a": {...} }`.

### Step 2: Create CurveExtractor

Reuse the key serialization pattern from `TimelineExtractor.cpp` (the `FRichCurveKey` serialization at lines ~60-90):

```cpp
// Key serialization (matches TimelineExtractor pattern):
static TSharedPtr<FJsonObject> SerializeCurveKey(const FRichCurveKey& Key)
{
    TSharedPtr<FJsonObject> KeyObj = MakeShared<FJsonObject>();
    KeyObj->SetNumberField(TEXT("time"), Key.Time);
    KeyObj->SetNumberField(TEXT("value"), Key.Value);
    KeyObj->SetNumberField(TEXT("arriveTangent"), Key.ArriveTangent);
    KeyObj->SetNumberField(TEXT("leaveTangent"), Key.LeaveTangent);
    KeyObj->SetStringField(TEXT("interpMode"), InterpModeToString(Key.InterpMode));
    return KeyObj;
}
```

Handle all 3 curve types:
- `UCurveFloat` → single channel from `FloatCurve` (FRichCurve)
- `UCurveVector` → 3 channels from `FloatCurves[0..2]`
- `UCurveLinearColor` → 4 channels from `FloatCurves[0..3]`

### Step 3: Create CurveTableExtractor

Note: This is different from `DataTableExtractor`. CurveTables contain rows of curves, not flat data.

```json
{
  "schemaVersion": "1.2.0",
  "curveTable": {
    "assetPath": "/Game/Data/CT_DifficultyScaling",
    "assetName": "CT_DifficultyScaling",
    "rowCount": 3,
    "rows": [
      {
        "rowName": "DamageMultiplier",
        "curve": {
          "keys": [...]
        }
      }
    ]
  }
}
```

**Key UE API calls:**
```cpp
#include "Curves/CurveFloat.h"
#include "Curves/CurveVector.h"
#include "Curves/CurveLinearColor.h"
#include "Engine/CurveTable.h"

// CurveTable:
CurveTable->GetRowMap()  // TMap<FName, FRealCurve*>
// Each FRealCurve has GetNumKeys(), GetKey(Index)
```

### Step 4: Add Library + Subsystem + MCP (same pattern)

### Step 5: Cascade integration — curves don't reference other extractable assets, so just add as extraction targets

### Step 6: Build + verify + commit

```
feat: add Curve and CurveTable extraction (extract_curve, extract_curvetable)
```

---

## Task 2.4: Material Instance Extraction

**Goal:** Add `extract_material_instance` MCP tool. Extract parent material, parameter overrides, and static switch states.

**Files:**
- Modify: `BlueprintExtractor/Source/BlueprintExtractor/BlueprintExtractor.Build.cs` (add MaterialEditor dependency if needed)
- Create: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/MaterialInstanceExtractor.h`
- Create: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/MaterialInstanceExtractor.cpp`
- Modify: **Library.h** / **Library.cpp**
- Modify: **Subsystem.h** / **Subsystem.cpp**
- Modify: **MCP/index.ts**

### Step 1: Add module dependency (if needed)

Material parameter access may require `MaterialEditor` module. Check if `UMaterialEditingLibrary` needs it, or if the runtime `UMaterialInstanceConstant` API is sufficient for read-only extraction.

For read-only extraction, `Engine` module (already included) should be sufficient. `UMaterialInstanceConstant` is in `Engine`. Parameter enumeration uses `UMaterialInterface` methods.

### Step 2: Design MaterialInstance JSON schema

```json
{
  "schemaVersion": "1.2.0",
  "materialInstance": {
    "assetPath": "/Game/Materials/MI_Character_Skin",
    "assetName": "MI_Character_Skin",
    "parentMaterial": "/Game/Materials/M_Character_Base",
    "baseMaterial": "/Engine/Materials/M_Default",
    "scalarParameters": [
      { "name": "Roughness", "value": 0.3, "group": "Surface" }
    ],
    "vectorParameters": [
      { "name": "BaseColor", "value": { "r": 0.8, "g": 0.6, "b": 0.4, "a": 1.0 }, "group": "Surface" }
    ],
    "textureParameters": [
      { "name": "DiffuseMap", "value": "/Game/Textures/T_Skin_D", "group": "Textures" }
    ],
    "staticSwitchParameters": [
      { "name": "UseNormalMap", "value": true, "isOverridden": true }
    ],
    "fontParameters": [],
    "runtimeVirtualTextureParameters": []
  }
}
```

### Step 3: Create MaterialInstanceExtractor

```cpp
// MaterialInstanceExtractor.h
#pragma once
#include "CoreMinimal.h"
#include "Dom/JsonObject.h"

class UMaterialInstance;

struct FMaterialInstanceExtractor
{
    static TSharedPtr<FJsonObject> Extract(const UMaterialInstance* MaterialInstance);
};
```

Implementation approach — use `UMaterialInstance` parameter query APIs:

```cpp
// Scalar parameters:
for (const FScalarParameterValue& Param : MaterialInstance->ScalarParameterValues)
{
    // Param.ParameterInfo.Name, Param.ParameterValue, Param.ParameterInfo.Group
}

// Vector parameters:
for (const FVectorParameterValue& Param : MaterialInstance->VectorParameterValues)
{
    // Param.ParameterInfo.Name, Param.ParameterValue (FLinearColor)
}

// Texture parameters:
for (const FTextureParameterValue& Param : MaterialInstance->TextureParameterValues)
{
    // Param.ParameterInfo.Name, Param.ParameterValue (UTexture*)
}

// Static parameters (requires UMaterialInstanceConstant):
if (const UMaterialInstanceConstant* MIC = Cast<UMaterialInstanceConstant>(MaterialInstance))
{
    FStaticParameterSet StaticParams;
    MIC->GetStaticParameterValues(StaticParams);
    for (const FStaticSwitchParameter& Switch : StaticParams.StaticSwitchParameters)
    {
        // Switch.ParameterInfo.Name, Switch.Value, Switch.bOverride
    }
}

// Parent:
MaterialInstance->Parent->GetPathName()

// Base material (root of the chain):
MaterialInstance->GetBaseMaterial()->GetPathName()
```

**Risk note:** The `FStaticParameterSet` API and member names may differ between UE versions. In UE 5.4+, static parameters were restructured. Verify against UE 5.6/5.7 API. If `StaticSwitchParameters` is not directly accessible, use `GetAllStaticSwitchParameterInfo` + `GetStaticSwitchParameterValue` instead.

### Step 4: Subsystem needs to load as UMaterialInstance

In **Subsystem.cpp**, the `ExtractMaterialInstance` handler needs to load the asset:

```cpp
UObject* Asset = LoadObject<UMaterialInstance>(nullptr, *AssetPath);
if (!Asset)
{
    // Try loading as generic object and casting
    Asset = LoadObject<UObject>(nullptr, *AssetPath);
}
UMaterialInstance* MI = Cast<UMaterialInstance>(Asset);
```

### Step 5: Add Library + Subsystem + MCP (same pattern)

### Step 6: Cascade integration

Material instances reference their parent material, which may be another material instance (forming a chain). Add to cascade:

```cpp
else if (UMaterialInstance* MI = Cast<UMaterialInstance>(Current.Asset))
{
    AssetType = TEXT("MaterialInstance");
    bSuccess = ExtractMaterialInstanceToJson(MI, FullPath);
    if (Current.Depth < MaxDepth && MI->Parent)
    {
        if (UMaterialInstance* ParentMI = Cast<UMaterialInstance>(MI->Parent))
        {
            Refs.AddUnique(FSoftObjectPath(ParentMI));
        }
    }
}
```

### Step 7: Build + verify + commit

```
feat: add MaterialInstance extraction (extract_material_instance)
```

---

## Task 2.5: Non-Graph Animation Asset Extraction

**Goal:** Add `extract_anim_sequence`, `extract_anim_montage`, and `extract_blend_space` MCP tools.

**Files:**
- Create: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/AnimAssetExtractor.h`
- Create: `BlueprintExtractor/Source/BlueprintExtractor/Private/Extractors/AnimAssetExtractor.cpp`
- Modify: **Library.h** / **Library.cpp**
- Modify: **Subsystem.h** / **Subsystem.cpp**
- Modify: **MCP/index.ts** (add 3 tools)

### Step 1: Design AnimSequence JSON schema

```json
{
  "schemaVersion": "1.2.0",
  "animSequence": {
    "assetPath": "/Game/Animations/AS_Walk",
    "assetName": "AS_Walk",
    "skeleton": "/Game/Characters/SK_Character",
    "sequenceLength": 1.2,
    "rateScale": 1.0,
    "numFrames": 36,
    "isAdditive": false,
    "additiveAnimType": "NoAdditive",
    "notifies": [
      {
        "notifyName": "FootstepL",
        "notifyClass": "AnimNotify_PlaySound",
        "triggerTime": 0.3,
        "duration": 0.0,
        "properties": { ... }
      }
    ],
    "syncMarkers": [
      { "markerName": "LeftFoot", "time": 0.0 },
      { "markerName": "RightFoot", "time": 0.6 }
    ],
    "curves": [
      {
        "curveName": "RootMotionWeight",
        "curveType": "Float",
        "keys": [ ... ]
      }
    ]
  }
}
```

### Step 2: Design AnimMontage JSON schema

```json
{
  "schemaVersion": "1.2.0",
  "animMontage": {
    "assetPath": "/Game/Animations/AM_Attack",
    "assetName": "AM_Attack",
    "skeleton": "/Game/Characters/SK_Character",
    "sequenceLength": 2.0,
    "slots": [
      {
        "slotName": "DefaultSlot",
        "segments": [
          {
            "animSequence": "/Game/Animations/AS_AttackSwing",
            "startTime": 0.0,
            "endTime": 1.0,
            "animStartTime": 0.0,
            "animEndTime": 1.0,
            "animPlayRate": 1.0
          }
        ]
      }
    ],
    "sections": [
      { "sectionName": "Default", "startTime": 0.0, "nextSectionName": "" },
      { "sectionName": "Recovery", "startTime": 1.0, "nextSectionName": "" }
    ],
    "branchingPoints": [ ... ],
    "notifies": [ ... ]
  }
}
```

### Step 3: Design BlendSpace JSON schema

```json
{
  "schemaVersion": "1.2.0",
  "blendSpace": {
    "assetPath": "/Game/Animations/BS_Locomotion",
    "assetName": "BS_Locomotion",
    "skeleton": "/Game/Characters/SK_Character",
    "is1D": false,
    "axisX": { "name": "Speed", "min": 0.0, "max": 600.0, "gridDivisions": 4 },
    "axisY": { "name": "Direction", "min": -180.0, "max": 180.0, "gridDivisions": 4 },
    "samples": [
      {
        "animation": "/Game/Animations/AS_Idle",
        "sampleValue": { "x": 0.0, "y": 0.0 },
        "rateScale": 1.0
      }
    ]
  }
}
```

### Step 4: Create AnimAssetExtractor

Single extractor file with static methods for each type:

```cpp
// AnimAssetExtractor.h
#pragma once
#include "CoreMinimal.h"
#include "Dom/JsonObject.h"

class UAnimSequence;
class UAnimMontage;
class UBlendSpace;

struct FAnimAssetExtractor
{
    static TSharedPtr<FJsonObject> ExtractAnimSequence(const UAnimSequence* AnimSequence);
    static TSharedPtr<FJsonObject> ExtractAnimMontage(const UAnimMontage* AnimMontage);
    static TSharedPtr<FJsonObject> ExtractBlendSpace(const UBlendSpace* BlendSpace);

private:
    static TArray<TSharedPtr<FJsonValue>> ExtractNotifies(const UAnimSequenceBase* AnimBase);
    static TArray<TSharedPtr<FJsonValue>> ExtractCurves(const UAnimSequenceBase* AnimBase);
};
```

**Key UE API calls:**

```cpp
// AnimSequence:
AnimSeq->GetPlayLength()                   // float
AnimSeq->RateScale                         // float
AnimSeq->GetNumberOfSampledKeys()          // int32
AnimSeq->IsValidAdditive()                 // bool
AnimSeq->GetSkeleton()->GetPathName()      // FString

// Notifies (shared across AnimSequenceBase):
AnimBase->Notifies                         // TArray<FAnimNotifyEvent>
Notify.NotifyName                          // FName
Notify.Notify                              // UAnimNotify* (subclass determines type)
Notify.GetTriggerTime()                    // float
Notify.GetDuration()                       // float

// AnimMontage:
Montage->SlotAnimTracks                    // TArray<FSlotAnimationTrack>
Track.SlotName                             // FName
Track.AnimTrack.AnimSegments               // TArray<FAnimSegment>
Montage->CompositeSections                 // TArray<FCompositeSection>

// BlendSpace:
BlendSpace->IsA<UBlendSpace1D>()           // bool (1D check)
BlendSpace->GetBlendParameter(0/1)         // FBlendParameter (axis info)
BlendSpace->GetBlendSample(i)              // FBlendSample
BlendSpace->GetNumberOfBlendSamples()      // int32
Sample.Animation                           // UAnimSequence*
Sample.SampleValue                         // FVector
```

### Step 5: Add Library + Subsystem + MCP (3 extraction methods, 3 UFUNCTIONs, 3 MCP tools)

### Step 6: Cascade integration — animation assets reference their skeleton and other anim assets (montage → sequences). Add to cascade if desired, but keep simple initially.

### Step 7: Build + verify + commit

```
feat: add AnimSequence, AnimMontage, and BlendSpace extraction
```

---

## Phase 2 Completion Checkpoint

After all Phase 2 tasks:

1. **Verify:** All 10 new extractor methods build and link
2. **Verify:** All 10 new MCP tools respond correctly
3. **Verify:** Cascade handles new asset types in its BFS loop
4. **Verify:** All new extractors use `BlueprintExtractor::SchemaVersion` and `FPropertySerializer`
5. **Update Build.cs:** Confirm `AIModule` is added (for BehaviorTree)
6. **Update .uplugin dependencies:** If any plugin deps are needed (unlikely for Phase 2)
7. **Version bump:** Plugin → 1.2, MCP → 1.8.0, Schema → 1.2.0
8. **Update README:**
   - Add BehaviorTree, Blackboard, UserDefinedStruct, UserDefinedEnum, Curve, CurveTable, MaterialInstance, AnimSequence, AnimMontage, BlendSpace to "What Gets Extracted"
   - Add 10 new tools to MCP Tools table
   - Update tool count from "11 tools" to "21 tools"
   - Add new dependencies note (AIModule)
   - Add changelog entries
9. **Update MCP/package.json:** Bump version to 1.8.0
10. **Commit:** `release: v1.8.0 — 10 new extraction tools`

---

# Risk Register

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| UE API differences between 5.6 and 5.7 for static material parameters | Medium | Medium | Verify API against both versions before implementing. Use runtime feature detection if needed. |
| `CurrentMessageLog` not available on all UE versions for compile diagnostics | Medium | Medium | Implement fallback to status-based detection. Document which UE versions support full diagnostics. |
| BehaviorTree `Children` array structure changed in recent UE versions | Medium | Low | Test against UE 5.6+ specifically. The core `FBTCompositeChild` structure has been stable since UE 4.x. |
| `FARFilter.ClassPaths` with `FTopLevelAssetPath` doesn't match Blueprint subclasses correctly | Low | Medium | Test the filtered query carefully. Fall back to path-only filtering + post-filter if class filtering is unreliable. |
| Typed property serialization breaks downstream LLM parsers that assumed string values | Medium | High | This is intentional and documented as a schema version bump (1.0.0 → 1.1.0). Announce in changelog. |
| Container type serialization (TArray/TSet/TMap) produces very large JSON for big arrays | Low | Low | Same truncation logic (200KB) already exists in MCP. Arrays are common in UE but typically small for user-facing properties. |
| Cascade manifest changes break existing cascade consumers | Low | Low | The change is additive (adds `assets` array, keeps `extracted_count`). `output_directory` is moved from subsystem to library return. |
| New module dependency (AIModule) causes build failures on minimal UE installations | Low | Low | AIModule is a core UE module, always available. Not a plugin dependency. |

---

# Implementation Effort Estimates

| Task | New Files | Modified Files | Complexity |
|---|---|---|---|
| 1.1 Schema Version | 1 | 4 | Trivial |
| 1.2 Shared Serializer | 2 | 2 | Medium (container handling) |
| 1.3 Migrate Extractors | 0 | 3 | Low |
| 1.4 Cascade Compact | 0 | 1 | Trivial |
| 1.5 Cascade Filenames + Manifest | 0 | 4 | Medium |
| 1.6 Compile Diagnostics | 0 | 1 | Medium (API research) |
| 1.7 Search Scalability | 0 | 2 | Low-Medium |
| 2.1 BehaviorTree + Blackboard | 4 | 5 | Medium |
| 2.2 UDStruct + UDEnum | 4 | 5 | Medium |
| 2.3 Curve + CurveTable | 4 | 5 | Low-Medium |
| 2.4 Material Instance | 2 | 5 | Medium |
| 2.5 Animation Assets | 2 | 5 | Medium-High |

**Totals:** 19 new files, ~40 file modifications across both phases.

---

# Parallelization Strategy

**Phase 1 parallel tracks** (4 independent tracks):
- Track A: Tasks 1.1 → 1.2 → 1.3 (sequential, schema → serializer → migration)
- Track B: Tasks 1.4 → 1.5 (sequential, cascade contract → cascade filenames)
- Track C: Task 1.6 (independent, compile diagnostics)
- Track D: Task 1.7 (independent, search scalability)

**Phase 2 parallel tracks** (5 independent extractors after Phase 1):
- All 5 extractor tasks can run in parallel since they touch different files
- The only shared files are Library.h/.cpp, Subsystem.h/.cpp, and MCP/index.ts
- To avoid merge conflicts: assign each task non-overlapping line ranges in shared files, or serialize the final integration step

**Recommended approach:** Use `subagent-driven-development` with one subagent per independent track. Phase 1 Track A must complete before Phase 2 starts (to provide the shared serializer). Tracks B, C, D can run alongside Phase 2 if needed.
