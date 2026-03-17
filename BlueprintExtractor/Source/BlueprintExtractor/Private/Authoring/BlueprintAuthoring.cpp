#include "Authoring/BlueprintAuthoring.h"

#include "Authoring/AssetMutationHelpers.h"
#include "Authoring/AuthoringHelpers.h"
#include "PropertySerializer.h"

#include "AssetRegistry/AssetRegistryModule.h"
#include "EdGraphSchema_K2_Actions.h"
#include "Components/ActorComponent.h"
#include "EdGraph/EdGraph.h"
#include "EdGraphSchema_K2.h"
#include "Engine/Blueprint.h"
#include "Engine/MemberReference.h"
#include "Engine/SCS_Node.h"
#include "Engine/SimpleConstructionScript.h"
#include "K2Node_CallFunction.h"
#include "K2Node_ExecutionSequence.h"
#include "K2Node_FunctionEntry.h"
#include "Kismet2/BlueprintEditorUtils.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "Misc/PackageName.h"
#include "PackageTools.h"
#include "UObject/Package.h"
#include "UObject/UObjectGlobals.h"

namespace BlueprintAuthoringInternal
{

enum class EBlueprintMutationFlags : uint8
{
	None = 0,
	Defaults = 1 << 0,
	Structural = 1 << 1,
	Compile = 1 << 2
};
ENUM_CLASS_FLAGS(EBlueprintMutationFlags);

static TSharedPtr<FJsonObject> NormalizePayload(
	const TSharedPtr<FJsonObject>& PayloadJson)
{
	if (!PayloadJson.IsValid())
	{
		return MakeShared<FJsonObject>();
	}

	const TSharedPtr<FJsonObject>* BlueprintObject = nullptr;
	if (PayloadJson->TryGetObjectField(TEXT("blueprint"), BlueprintObject)
		&& BlueprintObject
		&& BlueprintObject->IsValid())
	{
		return *BlueprintObject;
	}

	return PayloadJson;
}

static TArray<TSharedPtr<FJsonValue>> GetVariablesArray(
	const TSharedPtr<FJsonObject>& Payload)
{
	const TArray<TSharedPtr<FJsonValue>>* Variables = nullptr;
	if (Payload.IsValid()
		&& Payload->TryGetArrayField(TEXT("variables"), Variables)
		&& Variables)
	{
		return *Variables;
	}

	return {};
}

static TArray<TSharedPtr<FJsonValue>> GetFunctionArray(
	const TSharedPtr<FJsonObject>& Payload)
{
	const TArray<TSharedPtr<FJsonValue>>* Functions = nullptr;
	if (Payload.IsValid()
		&& Payload->TryGetArrayField(TEXT("functionGraphs"), Functions)
		&& Functions)
	{
		return *Functions;
	}

	if (Payload.IsValid()
		&& Payload->TryGetArrayField(TEXT("functionStubs"), Functions)
		&& Functions)
	{
		return *Functions;
	}

	if (Payload.IsValid()
		&& Payload->TryGetArrayField(TEXT("functions"), Functions)
		&& Functions)
	{
		return *Functions;
	}

	return {};
}

static TSharedPtr<FJsonObject> GetClassDefaultsObject(
	const TSharedPtr<FJsonObject>& Payload)
{
	if (!Payload.IsValid())
	{
		return nullptr;
	}

	const TSharedPtr<FJsonObject>* DefaultsObject = nullptr;
	if (Payload->TryGetObjectField(TEXT("classDefaults"), DefaultsObject)
		&& DefaultsObject
		&& DefaultsObject->IsValid())
	{
		return *DefaultsObject;
	}

	if (Payload->TryGetObjectField(TEXT("class_defaults"), DefaultsObject)
		&& DefaultsObject
		&& DefaultsObject->IsValid())
	{
		return *DefaultsObject;
	}

	if (Payload->TryGetObjectField(TEXT("properties"), DefaultsObject)
		&& DefaultsObject
		&& DefaultsObject->IsValid())
	{
		return *DefaultsObject;
	}

	return nullptr;
}

static TArray<TSharedPtr<FJsonValue>> GetRootComponentsArray(
	const TSharedPtr<FJsonObject>& Payload)
{
	if (!Payload.IsValid())
	{
		return {};
	}

	const TArray<TSharedPtr<FJsonValue>>* RootComponents = nullptr;
	if (Payload->TryGetArrayField(TEXT("rootComponents"), RootComponents)
		&& RootComponents)
	{
		return *RootComponents;
	}

	const TSharedPtr<FJsonObject>* ComponentsObject = nullptr;
	if (Payload->TryGetObjectField(TEXT("components"), ComponentsObject)
		&& ComponentsObject
		&& ComponentsObject->IsValid()
		&& (*ComponentsObject)->TryGetArrayField(TEXT("rootComponents"), RootComponents)
		&& RootComponents)
	{
		return *RootComponents;
	}

	return {};
}

static bool ParseVariableName(const TSharedPtr<FJsonObject>& VariableObject,
                              FString& OutVariableName)
{
	return VariableObject.IsValid()
		&& ((VariableObject->TryGetStringField(TEXT("name"), OutVariableName)
		     || VariableObject->TryGetStringField(
			     TEXT("variableName"),
			     OutVariableName))
		    && !OutVariableName.IsEmpty());
}

static bool ParseComponentName(const TSharedPtr<FJsonObject>& ComponentObject,
                               FString& OutComponentName)
{
	return ComponentObject.IsValid()
		&& ((ComponentObject->TryGetStringField(TEXT("componentName"), OutComponentName)
		     || ComponentObject->TryGetStringField(TEXT("name"), OutComponentName))
		    && !OutComponentName.IsEmpty());
}

static bool ParseFunctionName(const TSharedPtr<FJsonObject>& FunctionObject,
                              FString& OutFunctionName)
{
	return FunctionObject.IsValid()
		&& ((FunctionObject->TryGetStringField(TEXT("functionName"), OutFunctionName)
		     || FunctionObject->TryGetStringField(TEXT("graphName"), OutFunctionName)
		     || FunctionObject->TryGetStringField(TEXT("name"), OutFunctionName))
		    && !OutFunctionName.IsEmpty());
}

static int32 FindVariableIndex(const UBlueprint* Blueprint, const FName VariableName)
{
	return Blueprint
		? FBlueprintEditorUtils::FindNewVariableIndex(Blueprint, VariableName)
		: INDEX_NONE;
}

static UEdGraph* FindFunctionGraph(UBlueprint* Blueprint, const FName GraphName)
{
	if (!Blueprint)
	{
		return nullptr;
	}

	for (UEdGraph* Graph : Blueprint->FunctionGraphs)
	{
		if (Graph && Graph->GetFName() == GraphName)
		{
			return Graph;
		}
	}

	return nullptr;
}

static UK2Node_FunctionEntry* FindFunctionEntryNode(UEdGraph* Graph)
{
	if (!Graph)
	{
		return nullptr;
	}

	for (UEdGraphNode* Node : Graph->Nodes)
	{
		if (UK2Node_FunctionEntry* EntryNode = Cast<UK2Node_FunctionEntry>(Node))
		{
			return EntryNode;
		}
	}

	return nullptr;
}

static bool ParsePropertyFlags(const TSharedPtr<FJsonObject>& VariableObject,
                               uint64& OutFlags,
                               TArray<FString>& OutErrors)
{
	const TArray<TSharedPtr<FJsonValue>>* FlagsArray = nullptr;
	if (!VariableObject.IsValid()
		|| !VariableObject->TryGetArrayField(TEXT("propertyFlags"), FlagsArray)
		|| !FlagsArray)
	{
		return false;
	}

	OutFlags = 0;
	for (int32 Index = 0; Index < FlagsArray->Num(); ++Index)
	{
		FString FlagName;
		if (!(*FlagsArray)[Index].IsValid()
			|| !(*FlagsArray)[Index]->TryGetString(FlagName)
			|| FlagName.IsEmpty())
		{
			OutErrors.Add(FString::Printf(
				TEXT("propertyFlags[%d] must be a non-empty string."),
				Index));
			continue;
		}

#define CHECK_BLUEPRINT_FLAG(Flag) \
		if (FlagName == TEXT(#Flag))   \
		{                              \
			OutFlags |= Flag;          \
			continue;                  \
		}
		CHECK_BLUEPRINT_FLAG(CPF_Edit);
		CHECK_BLUEPRINT_FLAG(CPF_BlueprintVisible);
		CHECK_BLUEPRINT_FLAG(CPF_BlueprintReadOnly);
		CHECK_BLUEPRINT_FLAG(CPF_Net);
		CHECK_BLUEPRINT_FLAG(CPF_SaveGame);
		CHECK_BLUEPRINT_FLAG(CPF_EditConst);
		CHECK_BLUEPRINT_FLAG(CPF_DisableEditOnInstance);
		CHECK_BLUEPRINT_FLAG(CPF_DisableEditOnTemplate);
		CHECK_BLUEPRINT_FLAG(CPF_Transient);
		CHECK_BLUEPRINT_FLAG(CPF_Config);
		CHECK_BLUEPRINT_FLAG(CPF_RepNotify);
		CHECK_BLUEPRINT_FLAG(CPF_Interp);
		CHECK_BLUEPRINT_FLAG(CPF_ExposeOnSpawn);
		CHECK_BLUEPRINT_FLAG(CPF_BlueprintAssignable);
		CHECK_BLUEPRINT_FLAG(CPF_BlueprintCallable);
#undef CHECK_BLUEPRINT_FLAG

		OutErrors.Add(FString::Printf(
			TEXT("Unsupported Blueprint variable property flag '%s'."),
			*FlagName));
	}

	return OutErrors.Num() == 0;
}

static int32 ParseFunctionFlags(const TSharedPtr<FJsonObject>& FunctionObject,
                                TArray<FString>& OutErrors)
{
	int32 Flags = FUNC_BlueprintCallable | FUNC_Public;
	if (!FunctionObject.IsValid())
	{
		return Flags;
	}

	const TArray<TSharedPtr<FJsonValue>>* FunctionFlags = nullptr;
	if (FunctionObject->TryGetArrayField(TEXT("functionFlags"), FunctionFlags)
		&& FunctionFlags)
	{
		Flags &= ~(FUNC_Public | FUNC_Protected | FUNC_Private);
		for (int32 Index = 0; Index < FunctionFlags->Num(); ++Index)
		{
			FString FlagName;
			if (!(*FunctionFlags)[Index].IsValid()
				|| !(*FunctionFlags)[Index]->TryGetString(FlagName)
				|| FlagName.IsEmpty())
			{
				OutErrors.Add(FString::Printf(
					TEXT("functionFlags[%d] must be a non-empty string."),
					Index));
				continue;
			}

#define CHECK_FUNCTION_FLAG(Flag) \
			if (FlagName == TEXT(#Flag)) \
			{                           \
				Flags |= Flag;          \
				continue;               \
			}
			CHECK_FUNCTION_FLAG(FUNC_BlueprintCallable);
			CHECK_FUNCTION_FLAG(FUNC_BlueprintPure);
			CHECK_FUNCTION_FLAG(FUNC_Static);
			CHECK_FUNCTION_FLAG(FUNC_Const);
			CHECK_FUNCTION_FLAG(FUNC_Public);
			CHECK_FUNCTION_FLAG(FUNC_Protected);
			CHECK_FUNCTION_FLAG(FUNC_Private);
#undef CHECK_FUNCTION_FLAG

			OutErrors.Add(FString::Printf(
				TEXT("Unsupported Blueprint function flag '%s'."),
				*FlagName));
		}
	}

	FString AccessSpecifier;
	if (FunctionObject->TryGetStringField(TEXT("accessSpecifier"), AccessSpecifier)
		&& !AccessSpecifier.IsEmpty())
	{
		Flags &= ~(FUNC_Public | FUNC_Protected | FUNC_Private);
		if (AccessSpecifier.Equals(TEXT("Public"), ESearchCase::IgnoreCase))
		{
			Flags |= FUNC_Public;
		}
		else if (
			AccessSpecifier.Equals(TEXT("Protected"), ESearchCase::IgnoreCase))
		{
			Flags |= FUNC_Protected;
		}
		else if (
			AccessSpecifier.Equals(TEXT("Private"), ESearchCase::IgnoreCase))
		{
			Flags |= FUNC_Private;
		}
		else
		{
			OutErrors.Add(FString::Printf(
				TEXT("Unsupported accessSpecifier '%s'."),
				*AccessSpecifier));
		}
	}

	bool bFlagValue = false;
	if (FunctionObject->TryGetBoolField(TEXT("isPure"), bFlagValue) && bFlagValue)
	{
		Flags |= FUNC_BlueprintPure;
	}
	if (FunctionObject->TryGetBoolField(TEXT("isConst"), bFlagValue) && bFlagValue)
	{
		Flags |= FUNC_Const;
	}
	if (FunctionObject->TryGetBoolField(TEXT("isStatic"), bFlagValue)
		&& bFlagValue)
	{
		Flags |= FUNC_Static;
	}

	return Flags;
}

static bool ApplyVariableMetadata(
	FBPVariableDescription& VariableDescription,
	const TSharedPtr<FJsonObject>& VariableObject,
	const bool bReplaceMetadata,
	TArray<FString>& OutErrors)
{
	if (!VariableObject.IsValid())
	{
		return true;
	}

	const TSharedPtr<FJsonObject>* MetadataObject = nullptr;
	if (bReplaceMetadata)
	{
		VariableDescription.MetaDataArray.Reset();
	}

	if (VariableObject->TryGetObjectField(TEXT("metadata"), MetadataObject)
		&& MetadataObject
		&& MetadataObject->IsValid())
	{
		if (bReplaceMetadata)
		{
			VariableDescription.MetaDataArray.Reset();
		}

		for (const TPair<FString, TSharedPtr<FJsonValue>>& Pair
		     : (*MetadataObject)->Values)
		{
			FString MetadataValue;
			if (!Pair.Value.IsValid()
				|| !Pair.Value->TryGetString(MetadataValue))
			{
				OutErrors.Add(FString::Printf(
					TEXT("Variable metadata '%s' must be a string."),
					*Pair.Key));
				continue;
			}

			VariableDescription.SetMetaData(FName(*Pair.Key), MetadataValue);
		}
	}

	return OutErrors.Num() == 0;
}

static bool ApplyVariableDefinition(UBlueprint* Blueprint,
                                    const TSharedPtr<FJsonObject>& VariableObject,
                                    const bool bAllowCreate,
                                    const bool bReplaceMetadata,
                                    TArray<FString>& OutErrors)
{
	if (!Blueprint || !VariableObject.IsValid())
	{
		OutErrors.Add(TEXT("Variable payload must be an object."));
		return false;
	}

	FString VariableNameString;
	if (!ParseVariableName(VariableObject, VariableNameString))
	{
		OutErrors.Add(TEXT("Variable payload requires name or variableName."));
		return false;
	}

	FName VariableName(*VariableNameString);
	int32 VariableIndex = FindVariableIndex(Blueprint, VariableName);
	if (VariableIndex == INDEX_NONE)
	{
		if (!bAllowCreate)
		{
			OutErrors.Add(FString::Printf(
				TEXT("Blueprint variable '%s' was not found."),
				*VariableNameString));
			return false;
		}

		const TSharedPtr<FJsonObject>* PinTypeObject = nullptr;
		if (!(VariableObject->TryGetObjectField(TEXT("type"), PinTypeObject)
			  || VariableObject->TryGetObjectField(TEXT("pinType"), PinTypeObject))
			|| !PinTypeObject
			|| !PinTypeObject->IsValid())
		{
			OutErrors.Add(FString::Printf(
				TEXT("Variable '%s' requires a type object."),
				*VariableNameString));
			return false;
		}

		FEdGraphPinType ParsedPinType;
		FString ParseError;
		if (!FAuthoringHelpers::ParsePinType(
			    *PinTypeObject,
			    ParsedPinType,
			    ParseError))
		{
			OutErrors.Add(ParseError);
			return false;
		}

		FString DefaultValue;
		VariableObject->TryGetStringField(TEXT("defaultValue"), DefaultValue);
		if (!FBlueprintEditorUtils::AddMemberVariable(
			    Blueprint,
			    VariableName,
			    ParsedPinType,
			    DefaultValue))
		{
			OutErrors.Add(FString::Printf(
				TEXT("Failed to add Blueprint variable '%s'."),
				*VariableNameString));
			return false;
		}

		VariableIndex = FindVariableIndex(Blueprint, VariableName);
	}

	if (VariableIndex == INDEX_NONE || !Blueprint->NewVariables.IsValidIndex(VariableIndex))
	{
		OutErrors.Add(FString::Printf(
			TEXT("Failed to resolve Blueprint variable '%s' after mutation."),
			*VariableNameString));
		return false;
	}

	FString NewVariableName;
	if (VariableObject->TryGetStringField(TEXT("newName"), NewVariableName)
		&& !NewVariableName.IsEmpty()
		&& NewVariableName != VariableNameString)
	{
		FBlueprintEditorUtils::RenameMemberVariable(
			Blueprint,
			VariableName,
			FName(*NewVariableName));
		VariableName = FName(*NewVariableName);
		VariableIndex = FindVariableIndex(Blueprint, VariableName);
		if (VariableIndex == INDEX_NONE
			|| !Blueprint->NewVariables.IsValidIndex(VariableIndex))
		{
			OutErrors.Add(FString::Printf(
				TEXT("Failed to rename Blueprint variable '%s' to '%s'."),
				*VariableNameString,
				*NewVariableName));
			return false;
		}
	}

	const TSharedPtr<FJsonObject>* PinTypeObject = nullptr;
	if ((VariableObject->TryGetObjectField(TEXT("type"), PinTypeObject)
		 || VariableObject->TryGetObjectField(TEXT("pinType"), PinTypeObject))
		&& PinTypeObject
		&& PinTypeObject->IsValid())
	{
		FEdGraphPinType ParsedPinType;
		FString ParseError;
		if (!FAuthoringHelpers::ParsePinType(
			    *PinTypeObject,
			    ParsedPinType,
			    ParseError))
		{
			OutErrors.Add(ParseError);
			return false;
		}

		if (Blueprint->NewVariables[VariableIndex].VarType != ParsedPinType)
		{
			FBlueprintEditorUtils::ChangeMemberVariableType(
				Blueprint,
				VariableName,
				ParsedPinType);
			VariableIndex = FindVariableIndex(Blueprint, VariableName);
			if (!Blueprint->NewVariables.IsValidIndex(VariableIndex))
			{
				OutErrors.Add(FString::Printf(
					TEXT("Failed to change type for Blueprint variable '%s'."),
					*VariableName.ToString()));
				return false;
			}
		}
	}

	FBPVariableDescription& VariableDescription =
		Blueprint->NewVariables[VariableIndex];

	FString FriendlyName;
	if (VariableObject->TryGetStringField(TEXT("friendlyName"), FriendlyName))
	{
		VariableDescription.FriendlyName = FriendlyName;
	}

	FString Category;
	if (VariableObject->TryGetStringField(TEXT("category"), Category))
	{
		VariableDescription.Category = FText::FromString(Category);
	}

	FString DefaultValue;
	if (VariableObject->TryGetStringField(TEXT("defaultValue"), DefaultValue))
	{
		VariableDescription.DefaultValue = DefaultValue;
	}

	FString RepNotifyFunc;
	if (VariableObject->TryGetStringField(TEXT("repNotifyFunc"), RepNotifyFunc))
	{
		VariableDescription.RepNotifyFunc =
			RepNotifyFunc.IsEmpty() ? NAME_None : FName(*RepNotifyFunc);
	}

	uint64 PropertyFlags = 0;
	TArray<FString> PropertyFlagErrors;
	if (ParsePropertyFlags(VariableObject, PropertyFlags, PropertyFlagErrors))
	{
		VariableDescription.PropertyFlags = PropertyFlags;
	}
	for (const FString& Error : PropertyFlagErrors)
	{
		OutErrors.Add(Error);
	}

	ApplyVariableMetadata(
		VariableDescription,
		VariableObject,
		bReplaceMetadata,
		OutErrors);

	return OutErrors.Num() == 0;
}

static bool ReplaceVariables(UBlueprint* Blueprint,
                             const TArray<TSharedPtr<FJsonValue>>& Variables,
                             TArray<FString>& OutErrors)
{
	if (!Blueprint)
	{
		OutErrors.Add(TEXT("Blueprint is null."));
		return false;
	}

	TArray<FName> ExistingVariables;
	ExistingVariables.Reserve(Blueprint->NewVariables.Num());
	for (const FBPVariableDescription& Description : Blueprint->NewVariables)
	{
		ExistingVariables.Add(Description.VarName);
	}

	if (ExistingVariables.Num() > 0)
	{
		FBlueprintEditorUtils::BulkRemoveMemberVariables(Blueprint, ExistingVariables);
	}

	bool bSuccess = true;
	for (int32 Index = 0; Index < Variables.Num(); ++Index)
	{
		const TSharedPtr<FJsonObject> VariableObject =
			Variables[Index].IsValid() ? Variables[Index]->AsObject() : nullptr;
		if (!VariableObject.IsValid())
		{
			OutErrors.Add(FString::Printf(
				TEXT("variables[%d] must be an object."),
				Index));
			bSuccess = false;
			continue;
		}

		bSuccess &= ApplyVariableDefinition(
			Blueprint,
			VariableObject,
			true,
			true,
			OutErrors);
	}

	return bSuccess && OutErrors.Num() == 0;
}

static bool PatchVariable(UBlueprint* Blueprint,
                          const TSharedPtr<FJsonObject>& Payload,
                          TArray<FString>& OutErrors)
{
	if (!Payload.IsValid())
	{
		OutErrors.Add(TEXT("patch_variable requires a payload object."));
		return false;
	}

	const TSharedPtr<FJsonObject>* VariableObject = nullptr;
	if (Payload->TryGetObjectField(TEXT("variable"), VariableObject)
		&& VariableObject
		&& VariableObject->IsValid())
	{
		return ApplyVariableDefinition(
			Blueprint,
			*VariableObject,
			false,
			false,
			OutErrors);
	}

	return ApplyVariableDefinition(Blueprint, Payload, false, false, OutErrors);
}

static void ClearComponents(UBlueprint* Blueprint)
{
	if (!Blueprint || !Blueprint->SimpleConstructionScript)
	{
		return;
	}

	USimpleConstructionScript* SCS = Blueprint->SimpleConstructionScript;
	TArray<USCS_Node*> RootNodes;
	for (USCS_Node* RootNode : SCS->GetRootNodes())
	{
		RootNodes.Add(RootNode);
	}

	for (int32 Index = RootNodes.Num() - 1; Index >= 0; --Index)
	{
		if (RootNodes[Index])
		{
			SCS->RemoveNode(RootNodes[Index], false);
		}
	}

	SCS->ValidateSceneRootNodes();
}

static bool ApplyNodeMetadata(USCS_Node* Node,
                              const TSharedPtr<FJsonObject>& ComponentObject,
                              TArray<FString>& OutErrors)
{
	if (!Node || !ComponentObject.IsValid())
	{
		return true;
	}

	const TSharedPtr<FJsonObject>* MetadataObject = nullptr;
	if (ComponentObject->TryGetObjectField(TEXT("metadata"), MetadataObject)
		&& MetadataObject
		&& MetadataObject->IsValid())
	{
		for (const TPair<FString, TSharedPtr<FJsonValue>>& Pair
		     : (*MetadataObject)->Values)
		{
			FString MetadataValue;
			if (!Pair.Value.IsValid()
				|| !Pair.Value->TryGetString(MetadataValue))
			{
				OutErrors.Add(FString::Printf(
					TEXT("Component metadata '%s' must be a string."),
					*Pair.Key));
				continue;
			}

			Node->SetMetaData(FName(*Pair.Key), MetadataValue);
		}
	}

	return OutErrors.Num() == 0;
}

static bool ApplyComponentTemplateProperties(
	USCS_Node* Node,
	const TSharedPtr<FJsonObject>& ComponentObject,
	TArray<FString>& OutErrors)
{
	if (!Node || !Node->ComponentTemplate || !ComponentObject.IsValid())
	{
		return true;
	}

	const TSharedPtr<FJsonObject>* OverridesObject = nullptr;
	if (!(ComponentObject->TryGetObjectField(TEXT("propertyOverrides"), OverridesObject)
		  || ComponentObject->TryGetObjectField(TEXT("properties"), OverridesObject))
		|| !OverridesObject
		|| !OverridesObject->IsValid())
	{
		return true;
	}

	return FPropertySerializer::ApplyPropertiesFromJson(
		Node->ComponentTemplate,
		*OverridesObject,
		OutErrors,
		false,
		true);
}

static bool BuildComponentTree(UBlueprint* Blueprint,
                               USCS_Node* ParentNode,
                               const TSharedPtr<FJsonObject>& ComponentObject,
                               TSet<FName>& UsedNames,
                               TArray<FString>& OutErrors)
{
	if (!Blueprint || !Blueprint->SimpleConstructionScript)
	{
		OutErrors.Add(TEXT("Blueprint does not support SimpleConstructionScript components."));
		return false;
	}

	if (!ComponentObject.IsValid())
	{
		OutErrors.Add(TEXT("Component definition must be an object."));
		return false;
	}

	FString ComponentName;
	if (!ParseComponentName(ComponentObject, ComponentName))
	{
		OutErrors.Add(TEXT("Component definition requires componentName or name."));
		return false;
	}

	const FName ComponentFName(*ComponentName);
	if (UsedNames.Contains(ComponentFName))
	{
		OutErrors.Add(FString::Printf(
			TEXT("Duplicate component name '%s'."),
			*ComponentName));
		return false;
	}

	FString ComponentClassPath;
	if (!ComponentObject->TryGetStringField(TEXT("componentClass"), ComponentClassPath)
		|| ComponentClassPath.IsEmpty())
	{
		OutErrors.Add(FString::Printf(
			TEXT("Component '%s' requires componentClass."),
			*ComponentName));
		return false;
	}

	UClass* ComponentClass = FAuthoringHelpers::ResolveClass(
		ComponentClassPath,
		UActorComponent::StaticClass());
	if (!ComponentClass || ComponentClass->HasAnyClassFlags(CLASS_Abstract))
	{
		OutErrors.Add(FString::Printf(
			TEXT("Component class '%s' is not a concrete UActorComponent class."),
			*ComponentClassPath));
		return false;
	}

	USimpleConstructionScript* SCS = Blueprint->SimpleConstructionScript;
	USCS_Node* Node = SCS->CreateNode(ComponentClass, ComponentFName);
	if (!Node)
	{
		OutErrors.Add(FString::Printf(
			TEXT("Failed to create component node '%s'."),
			*ComponentName));
		return false;
	}

	UsedNames.Add(ComponentFName);

	FString AttachToName;
	if (ComponentObject->TryGetStringField(TEXT("attachToName"), AttachToName))
	{
		Node->AttachToName = AttachToName.IsEmpty() ? NAME_None : FName(*AttachToName);
	}

	ApplyNodeMetadata(Node, ComponentObject, OutErrors);
	ApplyComponentTemplateProperties(Node, ComponentObject, OutErrors);

	if (ParentNode)
	{
		ParentNode->AddChildNode(Node);
	}
	else
	{
		SCS->AddNode(Node);
	}

	const TArray<TSharedPtr<FJsonValue>>* Children = nullptr;
	if (ComponentObject->TryGetArrayField(TEXT("children"), Children) && Children)
	{
		for (int32 Index = 0; Index < Children->Num(); ++Index)
		{
			const TSharedPtr<FJsonObject> ChildObject =
				(*Children)[Index].IsValid() ? (*Children)[Index]->AsObject() : nullptr;
			if (!BuildComponentTree(
				    Blueprint,
				    Node,
				    ChildObject,
				    UsedNames,
				    OutErrors))
			{
				return false;
			}
		}
	}

	return OutErrors.Num() == 0;
}

static bool ReplaceComponents(UBlueprint* Blueprint,
                              const TArray<TSharedPtr<FJsonValue>>& RootComponents,
                              TArray<FString>& OutErrors)
{
	if (!Blueprint || !Blueprint->SimpleConstructionScript)
	{
		OutErrors.Add(TEXT("Blueprint does not support component authoring."));
		return false;
	}

	ClearComponents(Blueprint);

	TSet<FName> UsedNames;
	bool bSuccess = true;
	for (int32 Index = 0; Index < RootComponents.Num(); ++Index)
	{
		const TSharedPtr<FJsonObject> ComponentObject =
			RootComponents[Index].IsValid() ? RootComponents[Index]->AsObject() : nullptr;
		if (!ComponentObject.IsValid())
		{
			OutErrors.Add(FString::Printf(
				TEXT("rootComponents[%d] must be an object."),
				Index));
			bSuccess = false;
			continue;
		}

		bSuccess &= BuildComponentTree(
			Blueprint,
			nullptr,
			ComponentObject,
			UsedNames,
			OutErrors);
	}

	Blueprint->SimpleConstructionScript->ValidateSceneRootNodes();
	return bSuccess && OutErrors.Num() == 0;
}

static bool ReparentComponentNode(UBlueprint* Blueprint,
                                  USCS_Node* Node,
                                  USCS_Node* NewParent,
                                  TArray<FString>& OutErrors)
{
	if (!Blueprint || !Blueprint->SimpleConstructionScript || !Node)
	{
		OutErrors.Add(TEXT("Invalid component reparent request."));
		return false;
	}

	if (Node == NewParent || (NewParent && NewParent->IsChildOf(Node)))
	{
		OutErrors.Add(TEXT("Component reparent would create a cycle."));
		return false;
	}

	USimpleConstructionScript* SCS = Blueprint->SimpleConstructionScript;
	USCS_Node* OldParent = SCS->FindParentNode(Node);

	if (OldParent == NewParent)
	{
		return true;
	}

	if (OldParent)
	{
		OldParent->RemoveChildNode(Node, false);
	}
	else
	{
		SCS->RemoveNode(Node, false);
	}

	if (NewParent)
	{
		NewParent->AddChildNode(Node);
	}
	else
	{
		SCS->AddNode(Node);
	}

	SCS->ValidateSceneRootNodes();
	return true;
}

static bool PatchComponent(UBlueprint* Blueprint,
                           const TSharedPtr<FJsonObject>& Payload,
                           TArray<FString>& OutErrors)
{
	if (!Blueprint || !Blueprint->SimpleConstructionScript)
	{
		OutErrors.Add(TEXT("Blueprint does not support component authoring."));
		return false;
	}

	const TSharedPtr<FJsonObject>* ComponentObject = nullptr;
	TSharedPtr<FJsonObject> EffectivePayload = Payload;
	if (Payload.IsValid()
		&& Payload->TryGetObjectField(TEXT("component"), ComponentObject)
		&& ComponentObject
		&& ComponentObject->IsValid())
	{
		EffectivePayload = *ComponentObject;
	}

	FString ComponentName;
	if (!ParseComponentName(EffectivePayload, ComponentName))
	{
		OutErrors.Add(TEXT("patch_component requires componentName or name."));
		return false;
	}

	USCS_Node* Node = Blueprint->SimpleConstructionScript->FindSCSNode(FName(*ComponentName));
	if (!Node)
	{
		OutErrors.Add(FString::Printf(
			TEXT("Blueprint component '%s' was not found."),
			*ComponentName));
		return false;
	}

	FString NewName;
	if (EffectivePayload->TryGetStringField(TEXT("newName"), NewName)
		&& !NewName.IsEmpty()
		&& NewName != ComponentName)
	{
		Node->SetVariableName(FName(*NewName));
	}

	FString AttachToName;
	if (EffectivePayload->TryGetStringField(TEXT("attachToName"), AttachToName))
	{
		Node->AttachToName = AttachToName.IsEmpty() ? NAME_None : FName(*AttachToName);
	}

	FString ParentComponentName;
	if (EffectivePayload->TryGetStringField(TEXT("parentComponentName"), ParentComponentName))
	{
		USCS_Node* NewParentNode = nullptr;
		if (!ParentComponentName.IsEmpty())
		{
			NewParentNode =
				Blueprint->SimpleConstructionScript->FindSCSNode(FName(*ParentComponentName));
			if (!NewParentNode)
			{
				OutErrors.Add(FString::Printf(
					TEXT("Component parent '%s' was not found."),
					*ParentComponentName));
				return false;
			}
		}

		ReparentComponentNode(Blueprint, Node, NewParentNode, OutErrors);
	}

	ApplyNodeMetadata(Node, EffectivePayload, OutErrors);
	ApplyComponentTemplateProperties(Node, EffectivePayload, OutErrors);
	return OutErrors.Num() == 0;
}

static bool ApplyFunctionStub(UEdGraph* Graph,
                              const TSharedPtr<FJsonObject>& FunctionObject,
                              TArray<FString>& OutErrors)
{
	if (!Graph || !FunctionObject.IsValid())
	{
		OutErrors.Add(TEXT("Function stub payload must be an object."));
		return false;
	}

	FString Category;
	if (FunctionObject->TryGetStringField(TEXT("category"), Category))
	{
		FBlueprintEditorUtils::SetBlueprintFunctionOrMacroCategory(
			Graph,
			FText::FromString(Category),
			true);
	}

	UK2Node_FunctionEntry* EntryNode = FindFunctionEntryNode(Graph);
	if (!EntryNode)
	{
		OutErrors.Add(FString::Printf(
			TEXT("Function graph '%s' is missing a function entry node."),
			*Graph->GetName()));
		return false;
	}

	EntryNode->SetExtraFlags(ParseFunctionFlags(FunctionObject, OutErrors));
	return OutErrors.Num() == 0;
}

static bool ReplaceFunctionStubs(UBlueprint* Blueprint,
                                 const TArray<TSharedPtr<FJsonValue>>& Functions,
                                 TArray<FString>& OutErrors)
{
	if (!Blueprint)
	{
		OutErrors.Add(TEXT("Blueprint is null."));
		return false;
	}

	TArray<UEdGraph*> ExistingGraphs;
	for (UEdGraph* FunctionGraph : Blueprint->FunctionGraphs)
	{
		if (FunctionGraph)
		{
			ExistingGraphs.Add(FunctionGraph);
		}
	}

	if (ExistingGraphs.Num() > 0)
	{
		FBlueprintEditorUtils::RemoveGraphs(Blueprint, ExistingGraphs);
	}

	bool bSuccess = true;
	for (int32 Index = 0; Index < Functions.Num(); ++Index)
	{
		const TSharedPtr<FJsonObject> FunctionObject =
			Functions[Index].IsValid() ? Functions[Index]->AsObject() : nullptr;
		if (!FunctionObject.IsValid())
		{
			OutErrors.Add(FString::Printf(
				TEXT("functionStubs[%d] must be an object."),
				Index));
			bSuccess = false;
			continue;
		}

		FString FunctionName;
		if (!ParseFunctionName(FunctionObject, FunctionName))
		{
			OutErrors.Add(FString::Printf(
				TEXT("functionStubs[%d] requires functionName, graphName, or name."),
				Index));
			bSuccess = false;
			continue;
		}

		if (FindFunctionGraph(Blueprint, FName(*FunctionName)))
		{
			OutErrors.Add(FString::Printf(
				TEXT("Duplicate function graph '%s'."),
				*FunctionName));
			bSuccess = false;
			continue;
		}

		UEdGraph* NewGraph = FBlueprintEditorUtils::CreateNewGraph(
			Blueprint,
			FName(*FunctionName),
			UEdGraph::StaticClass(),
			UEdGraphSchema_K2::StaticClass());
		if (!NewGraph)
		{
			OutErrors.Add(FString::Printf(
				TEXT("Failed to create function graph '%s'."),
				*FunctionName));
			bSuccess = false;
			continue;
		}

		FBlueprintEditorUtils::AddFunctionGraph<UClass>(Blueprint, NewGraph, true, nullptr);
		bSuccess &= ApplyFunctionStub(NewGraph, FunctionObject, OutErrors);
	}

	return bSuccess && OutErrors.Num() == 0;
}

static bool UpsertFunctionStubs(UBlueprint* Blueprint,
                                const TArray<TSharedPtr<FJsonValue>>& Functions,
                                TArray<FString>& OutErrors)
{
	if (!Blueprint)
	{
		OutErrors.Add(TEXT("Blueprint is null."));
		return false;
	}

	bool bSuccess = true;
	for (int32 Index = 0; Index < Functions.Num(); ++Index)
	{
		const TSharedPtr<FJsonObject> FunctionObject =
			Functions[Index].IsValid() ? Functions[Index]->AsObject() : nullptr;
		if (!FunctionObject.IsValid())
		{
			OutErrors.Add(FString::Printf(
				TEXT("functionGraphs[%d] must be an object."),
				Index));
			bSuccess = false;
			continue;
		}

		FString FunctionName;
		if (!ParseFunctionName(FunctionObject, FunctionName))
		{
			OutErrors.Add(FString::Printf(
				TEXT("functionGraphs[%d] requires functionName, graphName, or name."),
				Index));
			bSuccess = false;
			continue;
		}

		bool bReplaceExisting = false;
		FunctionObject->TryGetBoolField(TEXT("replaceExisting"), bReplaceExisting);
		UEdGraph* TargetGraph = FindFunctionGraph(Blueprint, FName(*FunctionName));
		if (TargetGraph && bReplaceExisting)
		{
			TArray<UEdGraph*> GraphsToRemove = { TargetGraph };
			FBlueprintEditorUtils::RemoveGraphs(Blueprint, GraphsToRemove);
			TargetGraph = nullptr;
		}

		if (!TargetGraph)
		{
			TargetGraph = FBlueprintEditorUtils::CreateNewGraph(
				Blueprint,
				FName(*FunctionName),
				UEdGraph::StaticClass(),
				UEdGraphSchema_K2::StaticClass());
			if (!TargetGraph)
			{
				OutErrors.Add(FString::Printf(
					TEXT("Failed to create function graph '%s'."),
					*FunctionName));
				bSuccess = false;
				continue;
			}

			FBlueprintEditorUtils::AddFunctionGraph<UClass>(Blueprint, TargetGraph, true, nullptr);
		}

		bSuccess &= ApplyFunctionStub(TargetGraph, FunctionObject, OutErrors);
	}

	return bSuccess && OutErrors.Num() == 0;
}

static bool ReloadBlueprintPackage(UBlueprint* Blueprint, FString& OutError)
{
	if (!Blueprint)
	{
		OutError = TEXT("Blueprint is null.");
		return false;
	}

	UPackage* Package = Blueprint->GetOutermost();
	if (!Package)
	{
		OutError = TEXT("Blueprint package is null.");
		return false;
	}

	const TArray<UPackage*> PackagesToReload = { Package };
	FText ReloadError;
	const bool bReloaded = UPackageTools::ReloadPackages(
		PackagesToReload,
		ReloadError,
		EReloadPackagesInteractionMode::AssumePositive);
	if (!bReloaded)
	{
		OutError = ReloadError.ToString();
		return false;
	}

	return true;
}

static UEdGraphPin* FindPinByName(UEdGraphNode* Node, const FString& PinName)
{
	if (!Node)
	{
		return nullptr;
	}

	for (UEdGraphPin* Pin : Node->Pins)
	{
		if (Pin && Pin->PinName == FName(*PinName))
		{
			return Pin;
		}
	}

	return nullptr;
}

static bool AppendFunctionCallToSequence(UBlueprint* Blueprint,
                                         const TSharedPtr<FJsonObject>& Payload,
                                         TArray<FString>& OutErrors)
{
	if (!Blueprint || !Payload.IsValid())
	{
		OutErrors.Add(TEXT("append_function_call_to_sequence requires a Blueprint and payload."));
		return false;
	}

	FString GraphName;
	if (!Payload->TryGetStringField(TEXT("graphName"), GraphName) || GraphName.IsEmpty())
	{
		OutErrors.Add(TEXT("append_function_call_to_sequence requires graphName."));
		return false;
	}

	UEdGraph* Graph = FindFunctionGraph(Blueprint, FName(*GraphName));
	if (!Graph)
	{
		OutErrors.Add(FString::Printf(TEXT("Blueprint graph '%s' was not found."), *GraphName));
		return false;
	}

	FString FunctionName;
	if (!Payload->TryGetStringField(TEXT("functionName"), FunctionName) || FunctionName.IsEmpty())
	{
		OutErrors.Add(TEXT("append_function_call_to_sequence requires functionName."));
		return false;
	}

	UK2Node_ExecutionSequence* SequenceNode = nullptr;
	FString SequenceNodeTitle;
	Payload->TryGetStringField(TEXT("sequenceNodeTitle"), SequenceNodeTitle);
	for (UEdGraphNode* Node : Graph->Nodes)
	{
		UK2Node_ExecutionSequence* Candidate = Cast<UK2Node_ExecutionSequence>(Node);
		if (!Candidate)
		{
			continue;
		}

		if (SequenceNodeTitle.IsEmpty() || Candidate->GetNodeTitle(ENodeTitleType::ListView).ToString().Contains(SequenceNodeTitle))
		{
			SequenceNode = Candidate;
			break;
		}
	}

	if (!SequenceNode)
	{
		OutErrors.Add(FString::Printf(TEXT("No execution sequence node was found in graph '%s'."), *GraphName));
		return false;
	}

	double PosX = 0.0;
	double PosY = 0.0;
	Payload->TryGetNumberField(TEXT("posX"), PosX);
	Payload->TryGetNumberField(TEXT("posY"), PosY);
	const FVector2D NodePosition(PosX, PosY);

	UK2Node_CallFunction* CallFunctionNode = FEdGraphSchemaAction_K2NewNode::SpawnNode<UK2Node_CallFunction>(
		Graph,
		NodePosition,
		EK2NewNodeFlags::None,
		[&FunctionName, Blueprint, Payload](UK2Node_CallFunction* NewNode)
		{
			FString OwnerClassPath;
			if (Payload->TryGetStringField(TEXT("ownerClass"), OwnerClassPath) && !OwnerClassPath.IsEmpty())
			{
				if (UClass* OwnerClass = FAuthoringHelpers::ResolveClass(OwnerClassPath, UObject::StaticClass()))
				{
					if (UFunction* Function = OwnerClass->FindFunctionByName(FName(*FunctionName)))
					{
						NewNode->SetFromFunction(Function);
						return;
					}
				}
			}

			if (Blueprint && Blueprint->SkeletonGeneratedClass)
			{
				if (UFunction* Function = Blueprint->SkeletonGeneratedClass->FindFunctionByName(FName(*FunctionName)))
				{
					NewNode->SetFromFunction(Function);
					return;
				}
			}

			NewNode->FunctionReference.SetSelfMember(FName(*FunctionName));
		});

	if (!CallFunctionNode)
	{
		OutErrors.Add(FString::Printf(TEXT("Failed to create call node for '%s'."), *FunctionName));
		return false;
	}

	int32 ThenPinCount = 0;
	for (UEdGraphPin* Pin : SequenceNode->Pins)
	{
		if (Pin && Pin->Direction == EGPD_Output && Pin->PinType.PinCategory == UEdGraphSchema_K2::PC_Exec)
		{
			++ThenPinCount;
		}
	}

	if (ThenPinCount <= 0)
	{
		OutErrors.Add(TEXT("Execution sequence node did not expose any exec output pins."));
		return false;
	}

	const int32 AppendIndex = ThenPinCount - 1;
	SequenceNode->AddInputPin();
	UEdGraphPin* ThenPin = SequenceNode->GetThenPinGivenIndex(AppendIndex + 1);
	UEdGraphPin* ExecutePin = FindPinByName(CallFunctionNode, TEXT("execute"));
	if (!ThenPin || !ExecutePin)
	{
		OutErrors.Add(TEXT("Failed to resolve exec pins while appending a function call."));
		return false;
	}

	const UEdGraphSchema_K2* Schema = GetDefault<UEdGraphSchema_K2>();
	if (!Schema->TryCreateConnection(ThenPin, ExecutePin))
	{
		OutErrors.Add(TEXT("Failed to wire the appended function call into the sequence node."));
		return false;
	}

	return true;
}

static bool ApplyClassDefaults(UBlueprint* Blueprint,
                               const TSharedPtr<FJsonObject>& DefaultsObject,
                               TArray<FString>& OutErrors,
                               const bool bValidationOnly)
{
	if (!Blueprint || !DefaultsObject.IsValid())
	{
		return true;
	}

	UObject* DefaultTarget = nullptr;
	if (Blueprint->GeneratedClass)
	{
		DefaultTarget = Blueprint->GeneratedClass->GetDefaultObject();
	}

	if (!DefaultTarget)
	{
		OutErrors.Add(TEXT("Blueprint GeneratedClass is not available for class-default edits."));
		return false;
	}

	return FPropertySerializer::ApplyPropertiesFromJson(
		DefaultTarget,
		DefaultsObject,
		OutErrors,
		bValidationOnly,
		true);
}

static bool ApplyOperation(UBlueprint* Blueprint,
                           const FString& Operation,
                           const TSharedPtr<FJsonObject>& Payload,
                           TArray<FString>& OutErrors,
                           EBlueprintMutationFlags& OutMutationFlags)
{
	if (!Blueprint)
	{
		OutErrors.Add(TEXT("Blueprint is null."));
		return false;
	}

	if (Operation == TEXT("replace_variables"))
	{
		OutMutationFlags |=
			EBlueprintMutationFlags::Structural | EBlueprintMutationFlags::Compile;
		return ReplaceVariables(Blueprint, GetVariablesArray(Payload), OutErrors);
	}

	if (Operation == TEXT("patch_variable"))
	{
		OutMutationFlags |=
			EBlueprintMutationFlags::Structural | EBlueprintMutationFlags::Compile;
		return PatchVariable(Blueprint, Payload, OutErrors);
	}

	if (Operation == TEXT("replace_components"))
	{
		OutMutationFlags |=
			EBlueprintMutationFlags::Structural | EBlueprintMutationFlags::Compile;
		return ReplaceComponents(Blueprint, GetRootComponentsArray(Payload), OutErrors);
	}

	if (Operation == TEXT("patch_component"))
	{
		OutMutationFlags |=
			EBlueprintMutationFlags::Structural | EBlueprintMutationFlags::Compile;
		return PatchComponent(Blueprint, Payload, OutErrors);
	}

	if (Operation == TEXT("replace_function_stubs"))
	{
		OutMutationFlags |=
			EBlueprintMutationFlags::Structural | EBlueprintMutationFlags::Compile;
		return ReplaceFunctionStubs(Blueprint, GetFunctionArray(Payload), OutErrors);
	}

	if (Operation == TEXT("patch_class_defaults"))
	{
		OutMutationFlags |= EBlueprintMutationFlags::Defaults;
		return ApplyClassDefaults(
			Blueprint,
			GetClassDefaultsObject(Payload),
			OutErrors,
			false);
	}

	if (Operation == TEXT("compile"))
	{
		OutMutationFlags |= EBlueprintMutationFlags::Compile;
		return true;
	}

	OutErrors.Add(FString::Printf(
		TEXT("Unsupported Blueprint operation '%s'."),
		*Operation));
	return false;
}

static bool ApplyGraphOperation(UBlueprint* Blueprint,
                                const FString& Operation,
                                const TSharedPtr<FJsonObject>& Payload,
                                TArray<FString>& OutErrors,
                                EBlueprintMutationFlags& OutMutationFlags)
{
	if (!Blueprint)
	{
		OutErrors.Add(TEXT("Blueprint is null."));
		return false;
	}

	if (Operation == TEXT("upsert_function_graphs"))
	{
		OutMutationFlags |= EBlueprintMutationFlags::Structural | EBlueprintMutationFlags::Compile;
		return UpsertFunctionStubs(Blueprint, GetFunctionArray(Payload), OutErrors);
	}

	if (Operation == TEXT("append_function_call_to_sequence"))
	{
		OutMutationFlags |= EBlueprintMutationFlags::Structural | EBlueprintMutationFlags::Compile;
		return AppendFunctionCallToSequence(Blueprint, Payload, OutErrors);
	}

	if (Operation == TEXT("compile"))
	{
		OutMutationFlags |= EBlueprintMutationFlags::Compile;
		return true;
	}

	OutErrors.Add(FString::Printf(
		TEXT("Unsupported Blueprint graph operation '%s'."),
		*Operation));
	return false;
}

static bool ApplyCreatePayload(UBlueprint* Blueprint,
                               const TSharedPtr<FJsonObject>& Payload,
                               TArray<FString>& OutErrors)
{
	bool bSuccess = true;

	if (GetVariablesArray(Payload).Num() > 0)
	{
		bSuccess &= ReplaceVariables(Blueprint, GetVariablesArray(Payload), OutErrors);
	}

	if (GetRootComponentsArray(Payload).Num() > 0)
	{
		bSuccess &= ReplaceComponents(
			Blueprint,
			GetRootComponentsArray(Payload),
			OutErrors);
	}

	if (GetFunctionArray(Payload).Num() > 0)
	{
		bSuccess &= ReplaceFunctionStubs(
			Blueprint,
			GetFunctionArray(Payload),
			OutErrors);
	}

	if (const TSharedPtr<FJsonObject> DefaultsObject = GetClassDefaultsObject(Payload))
	{
		bSuccess &= ApplyClassDefaults(Blueprint, DefaultsObject, OutErrors, false);
	}

	return bSuccess;
}

} // namespace BlueprintAuthoringInternal

TSharedPtr<FJsonObject> FBlueprintAuthoring::Create(
	const FString& AssetPath,
	const FString& ParentClassPath,
	const TSharedPtr<FJsonObject>& PayloadJson,
	const bool bValidateOnly)
{
	using namespace BlueprintAuthoringInternal;

	FAssetMutationContext Context(
		TEXT("create_blueprint"),
		AssetPath,
		TEXT("Blueprint"),
		bValidateOnly);

	UClass* ParentClass = FAuthoringHelpers::ResolveClass(
		ParentClassPath,
		UObject::StaticClass());
	if (!ParentClass)
	{
		Context.AddError(
			TEXT("parent_class_not_found"),
			FString::Printf(TEXT("Parent class not found: %s"), *ParentClassPath),
			ParentClassPath);
		return Context.BuildResult(false);
	}

	if (!FKismetEditorUtilities::CanCreateBlueprintOfClass(ParentClass))
	{
		Context.AddError(
			TEXT("invalid_parent_class"),
			FString::Printf(
				TEXT("Class '%s' cannot be used to create a Blueprint."),
				*ParentClass->GetPathName()),
			ParentClassPath);
		return Context.BuildResult(false);
	}

	if (DoesAssetExist(AssetPath))
	{
		Context.AddError(
			TEXT("asset_exists"),
			FString::Printf(TEXT("Asset already exists: %s"), *AssetPath),
			AssetPath);
		return Context.BuildResult(false);
	}

	const TSharedPtr<FJsonObject> Payload = NormalizePayload(PayloadJson);

	const FName PreviewName = MakeUniqueObjectName(
		GetTransientPackage(),
		UBlueprint::StaticClass(),
		TEXT("BPPreview"));
	UBlueprint* PreviewBlueprint = FKismetEditorUtilities::CreateBlueprint(
		ParentClass,
		GetTransientPackage(),
		PreviewName,
		BPTYPE_Normal);
	if (!PreviewBlueprint)
	{
		Context.AddError(
			TEXT("preview_create_failed"),
			TEXT("Failed to create transient Blueprint preview."));
		return Context.BuildResult(false);
	}

	TArray<FString> ValidationErrors;
	ApplyCreatePayload(PreviewBlueprint, Payload, ValidationErrors);
	Context.SetValidationSummary(
		ValidationErrors.Num() == 0,
		ValidationErrors.Num() == 0
			? TEXT("Blueprint payload validated.")
			: TEXT("Blueprint payload failed validation."),
		ValidationErrors);
	for (const FString& Error : ValidationErrors)
	{
		Context.AddError(TEXT("validation_error"), Error, AssetPath);
	}
	if (ValidationErrors.Num() > 0)
	{
		return Context.BuildResult(false);
	}

	FAuthoringHelpers::CompileBlueprint(PreviewBlueprint, Context, TEXT("Blueprint"));
	if (Context.CompileSummary.IsValid()
		&& !Context.CompileSummary->GetBoolField(TEXT("success")))
	{
		return Context.BuildResult(false);
	}

	if (bValidateOnly)
	{
		return Context.BuildResult(true);
	}

	Context.BeginTransaction(FText::FromString(TEXT("Create Blueprint")));

	UPackage* Package = CreatePackage(*AssetPath);
	if (!Package)
	{
		Context.AddError(
			TEXT("package_create_failed"),
			FString::Printf(TEXT("Failed to create package: %s"), *AssetPath),
			AssetPath);
		return Context.BuildResult(false);
	}

	const FName AssetName = FPackageName::GetShortFName(AssetPath);
	UBlueprint* Blueprint = FKismetEditorUtilities::CreateBlueprint(
		ParentClass,
		Package,
		AssetName,
		BPTYPE_Normal);
	if (!Blueprint)
	{
		Context.AddError(
			TEXT("asset_create_failed"),
			FString::Printf(TEXT("Failed to create Blueprint asset: %s"), *AssetPath),
			AssetPath);
		return Context.BuildResult(false);
	}

	Blueprint->Modify();

	TArray<FString> ApplyErrors;
	ApplyCreatePayload(Blueprint, Payload, ApplyErrors);
	for (const FString& Error : ApplyErrors)
	{
		Context.AddError(TEXT("apply_error"), Error, AssetPath);
	}
	if (ApplyErrors.Num() > 0)
	{
		return Context.BuildResult(false);
	}

	FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(Blueprint);
	FAuthoringHelpers::CompileBlueprint(Blueprint, Context, TEXT("Blueprint"));
	if (Context.CompileSummary.IsValid()
		&& !Context.CompileSummary->GetBoolField(TEXT("success")))
	{
		return Context.BuildResult(false);
	}

	FAssetRegistryModule::AssetCreated(Blueprint);
	Package->MarkPackageDirty();
	Context.TrackDirtyObject(Blueprint);
	if (Blueprint->GeneratedClass && Blueprint->GeneratedClass->GetDefaultObject())
	{
		Context.TrackDirtyObject(Blueprint->GeneratedClass->GetDefaultObject());
	}

	return Context.BuildResult(true);
}

TSharedPtr<FJsonObject> FBlueprintAuthoring::Modify(
	UBlueprint* Blueprint,
	const FString& Operation,
	const TSharedPtr<FJsonObject>& PayloadJson,
	const bool bValidateOnly)
{
	using namespace BlueprintAuthoringInternal;

	const FString AssetPath = Blueprint ? Blueprint->GetPathName() : FString();
	FAssetMutationContext Context(
		TEXT("modify_blueprint_members"),
		AssetPath,
		TEXT("Blueprint"),
		bValidateOnly);

	if (!Blueprint)
	{
		Context.AddError(TEXT("asset_not_found"), TEXT("Blueprint is null."));
		return Context.BuildResult(false);
	}

	const TSharedPtr<FJsonObject> Payload = NormalizePayload(PayloadJson);
	UBlueprint* WorkingBlueprint = Blueprint;
	if (bValidateOnly)
	{
		WorkingBlueprint = DuplicateObject<UBlueprint>(Blueprint, GetTransientPackage());
		if (!WorkingBlueprint)
		{
			Context.AddError(
				TEXT("preview_duplicate_failed"),
				TEXT("Failed to duplicate Blueprint for validation."));
			return Context.BuildResult(false);
		}
	}

	TArray<FString> ValidationErrors;
	EBlueprintMutationFlags MutationFlags = EBlueprintMutationFlags::None;
	ApplyOperation(
		WorkingBlueprint,
		Operation,
		Payload,
		ValidationErrors,
		MutationFlags);
	Context.SetValidationSummary(
		ValidationErrors.Num() == 0,
		ValidationErrors.Num() == 0
			? TEXT("Blueprint payload validated.")
			: TEXT("Blueprint payload failed validation."),
		ValidationErrors);
	for (const FString& Error : ValidationErrors)
	{
		Context.AddError(TEXT("validation_error"), Error, AssetPath);
	}
	if (ValidationErrors.Num() > 0)
	{
		return Context.BuildResult(false);
	}

	if (EnumHasAnyFlags(MutationFlags, EBlueprintMutationFlags::Structural))
	{
		FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(WorkingBlueprint);
	}

	if (EnumHasAnyFlags(MutationFlags, EBlueprintMutationFlags::Compile))
	{
		FAuthoringHelpers::CompileBlueprint(WorkingBlueprint, Context, TEXT("Blueprint"));
		if (Context.CompileSummary.IsValid()
			&& !Context.CompileSummary->GetBoolField(TEXT("success")))
		{
			return Context.BuildResult(false);
		}
	}

	if (bValidateOnly)
	{
		return Context.BuildResult(true);
	}

	Context.BeginTransaction(FText::FromString(TEXT("Modify Blueprint")));
	Blueprint->Modify();

	auto RollbackBlueprint = [&Context, Blueprint, &AssetPath]()
	{
		FString ReloadError;
		const bool bRolledBack = ReloadBlueprintPackage(Blueprint, ReloadError);
		if (bRolledBack)
		{
			Context.AddWarning(TEXT("rollback_applied"),
			                   TEXT("Blueprint mutation failed and the package was reloaded from disk to discard in-memory changes."),
			                   AssetPath);
		}
		else
		{
			Context.AddError(TEXT("rollback_failed"),
			                 FString::Printf(TEXT("Blueprint mutation failed and rollback also failed: %s"), *ReloadError),
			                 AssetPath);
		}
	};

	TArray<FString> ApplyErrors;
	MutationFlags = EBlueprintMutationFlags::None;
	ApplyOperation(Blueprint, Operation, Payload, ApplyErrors, MutationFlags);
	for (const FString& Error : ApplyErrors)
	{
		Context.AddError(TEXT("apply_error"), Error, AssetPath);
	}
	if (ApplyErrors.Num() > 0)
	{
		RollbackBlueprint();
		return Context.BuildResult(false);
	}

	if (EnumHasAnyFlags(MutationFlags, EBlueprintMutationFlags::Structural))
	{
		FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(Blueprint);
	}
	else if (EnumHasAnyFlags(MutationFlags, EBlueprintMutationFlags::Defaults))
	{
		FBlueprintEditorUtils::MarkBlueprintAsModified(Blueprint);
	}

	if (EnumHasAnyFlags(MutationFlags, EBlueprintMutationFlags::Compile))
	{
		FAuthoringHelpers::CompileBlueprint(Blueprint, Context, TEXT("Blueprint"));
		if (Context.CompileSummary.IsValid()
			&& !Context.CompileSummary->GetBoolField(TEXT("success")))
		{
			RollbackBlueprint();
			return Context.BuildResult(false);
		}
	}

	Blueprint->MarkPackageDirty();
	Context.TrackDirtyObject(Blueprint);
	if (Blueprint->GeneratedClass && Blueprint->GeneratedClass->GetDefaultObject())
	{
		Context.TrackDirtyObject(Blueprint->GeneratedClass->GetDefaultObject());
	}

	return Context.BuildResult(true);
}

TSharedPtr<FJsonObject> FBlueprintAuthoring::ModifyGraphs(
	UBlueprint* Blueprint,
	const FString& Operation,
	const TSharedPtr<FJsonObject>& PayloadJson,
	const bool bValidateOnly)
{
	using namespace BlueprintAuthoringInternal;

	const FString AssetPath = Blueprint ? Blueprint->GetPathName() : FString();
	FAssetMutationContext Context(
		TEXT("modify_blueprint_graphs"),
		AssetPath,
		TEXT("Blueprint"),
		bValidateOnly);

	if (!Blueprint)
	{
		Context.AddError(TEXT("asset_not_found"), TEXT("Blueprint is null."));
		return Context.BuildResult(false);
	}

	const TSharedPtr<FJsonObject> Payload = NormalizePayload(PayloadJson);
	auto BuildGraphMutationResult = [&Context](UBlueprint* TargetBlueprint, const bool bSuccess) -> TSharedPtr<FJsonObject>
	{
		const TSharedPtr<FJsonObject> Result = Context.BuildResult(bSuccess);
		if (!Result.IsValid() || !TargetBlueprint)
		{
			return Result;
		}

		TArray<TSharedPtr<FJsonValue>> FunctionGraphNames;
		for (UEdGraph* Graph : TargetBlueprint->FunctionGraphs)
		{
			if (Graph)
			{
				FunctionGraphNames.Add(MakeShared<FJsonValueString>(Graph->GetName()));
			}
		}
		Result->SetArrayField(TEXT("functionGraphs"), FunctionGraphNames);
		return Result;
	};

	UBlueprint* WorkingBlueprint = Blueprint;
	if (bValidateOnly)
	{
		WorkingBlueprint = DuplicateObject<UBlueprint>(Blueprint, GetTransientPackage());
		if (!WorkingBlueprint)
		{
			Context.AddError(
				TEXT("preview_duplicate_failed"),
				TEXT("Failed to duplicate Blueprint for validation."));
			return Context.BuildResult(false);
		}
	}

	TArray<FString> ValidationErrors;
	EBlueprintMutationFlags MutationFlags = EBlueprintMutationFlags::None;
	ApplyGraphOperation(
		WorkingBlueprint,
		Operation,
		Payload,
		ValidationErrors,
		MutationFlags);
	Context.SetValidationSummary(
		ValidationErrors.Num() == 0,
		ValidationErrors.Num() == 0
			? TEXT("Blueprint graph payload validated.")
			: TEXT("Blueprint graph payload failed validation."),
		ValidationErrors);
	for (const FString& Error : ValidationErrors)
	{
		Context.AddError(TEXT("validation_error"), Error, AssetPath);
	}
	if (ValidationErrors.Num() > 0)
	{
		return Context.BuildResult(false);
	}

	if (EnumHasAnyFlags(MutationFlags, EBlueprintMutationFlags::Structural))
	{
		FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(WorkingBlueprint);
	}

	if (EnumHasAnyFlags(MutationFlags, EBlueprintMutationFlags::Compile))
	{
		FAuthoringHelpers::CompileBlueprint(WorkingBlueprint, Context, TEXT("Blueprint"));
		if (Context.CompileSummary.IsValid()
			&& !Context.CompileSummary->GetBoolField(TEXT("success")))
		{
			return Context.BuildResult(false);
		}
	}

	if (bValidateOnly)
	{
		return BuildGraphMutationResult(WorkingBlueprint, true);
	}

	Context.BeginTransaction(FText::FromString(TEXT("Modify Blueprint Graphs")));
	Blueprint->Modify();

	auto RollbackBlueprint = [&Context, Blueprint, &AssetPath]()
	{
		FString ReloadError;
		const bool bRolledBack = ReloadBlueprintPackage(Blueprint, ReloadError);
		if (bRolledBack)
		{
			Context.AddWarning(TEXT("rollback_applied"),
			                   TEXT("Blueprint graph mutation failed and the package was reloaded from disk to discard in-memory changes."),
			                   AssetPath);
		}
		else
		{
			Context.AddError(TEXT("rollback_failed"),
			                 FString::Printf(TEXT("Blueprint graph mutation failed and rollback also failed: %s"), *ReloadError),
			                 AssetPath);
		}
	};

	TArray<FString> ApplyErrors;
	MutationFlags = EBlueprintMutationFlags::None;
	ApplyGraphOperation(Blueprint, Operation, Payload, ApplyErrors, MutationFlags);
	for (const FString& Error : ApplyErrors)
	{
		Context.AddError(TEXT("apply_error"), Error, AssetPath);
	}
	if (ApplyErrors.Num() > 0)
	{
		RollbackBlueprint();
		return Context.BuildResult(false);
	}

	if (EnumHasAnyFlags(MutationFlags, EBlueprintMutationFlags::Structural))
	{
		FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(Blueprint);
	}

	if (EnumHasAnyFlags(MutationFlags, EBlueprintMutationFlags::Compile))
	{
		FAuthoringHelpers::CompileBlueprint(Blueprint, Context, TEXT("Blueprint"));
		if (Context.CompileSummary.IsValid()
			&& !Context.CompileSummary->GetBoolField(TEXT("success")))
		{
			RollbackBlueprint();
			return Context.BuildResult(false);
		}
	}

	Blueprint->MarkPackageDirty();
	Context.TrackDirtyObject(Blueprint);
	if (Blueprint->GeneratedClass && Blueprint->GeneratedClass->GetDefaultObject())
	{
		Context.TrackDirtyObject(Blueprint->GeneratedClass->GetDefaultObject());
	}

	return BuildGraphMutationResult(Blueprint, true);
}
