#include "BlueprintExtractorLibrary.h"
#include "BlueprintExtractorModule.h"
#include "BlueprintExtractorSettings.h"
#include "BlueprintJsonSchema.h"
#include "Extractors/ClassLevelExtractor.h"
#include "Extractors/VariableExtractor.h"
#include "Extractors/ComponentExtractor.h"
#include "Extractors/GraphExtractor.h"
#include "Extractors/TimelineExtractor.h"
#include "Extractors/BytecodeExtractor.h"
#include "Extractors/StateTreeExtractor.h"
#include "Engine/Blueprint.h"
#include "Engine/SimpleConstructionScript.h"
#include "Engine/SCS_Node.h"
#include "StateTree.h"
#include "StateTreeEditorData.h"
#include "StateTreeState.h"
#include "EdGraphSchema_K2.h"
#include "EdGraph/EdGraph.h"
#include "EdGraph/EdGraphNode.h"
#include "EdGraph/EdGraphPin.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Misc/FileHelper.h"

// ---------------------------------------------------------------------------
// JSON file writing helpers (shared by Blueprint and StateTree extraction)
// ---------------------------------------------------------------------------

static bool WriteJsonToFile(const TSharedPtr<FJsonObject>& JsonRoot, const FString& OutputPath)
{
	if (!JsonRoot)
	{
		return false;
	}

	FString OutputString;
	const UBlueprintExtractorSettings* Settings = UBlueprintExtractorSettings::Get();

	if (Settings->bPrettyPrint)
	{
		TSharedRef<TJsonWriter<TCHAR, TPrettyJsonPrintPolicy<TCHAR>>> Writer =
			TJsonWriterFactory<TCHAR, TPrettyJsonPrintPolicy<TCHAR>>::Create(&OutputString);
		FJsonSerializer::Serialize(JsonRoot.ToSharedRef(), Writer);
	}
	else
	{
		TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer =
			TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&OutputString);
		FJsonSerializer::Serialize(JsonRoot.ToSharedRef(), Writer);
	}

	FString FullPath = OutputPath;
	if (FPaths::GetExtension(FullPath).IsEmpty())
	{
		FullPath = FPaths::ChangeExtension(FullPath, TEXT("json"));
	}

	return FFileHelper::SaveStringToFile(OutputString, *FullPath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
}

// ---------------------------------------------------------------------------
// Cascade reference collection helpers
// ---------------------------------------------------------------------------

static void CollectRefsFromPinType(const FEdGraphPinType& PinType, TArray<FSoftObjectPath>& OutRefs)
{
	if (PinType.PinSubCategoryObject.IsValid())
	{
		UObject* SubObj = PinType.PinSubCategoryObject.Get();
		if (SubObj && SubObj->GetClass()->ClassGeneratedBy)
		{
			if (UBlueprint* RefBP = Cast<UBlueprint>(SubObj->GetClass()->ClassGeneratedBy))
			{
				OutRefs.AddUnique(FSoftObjectPath(RefBP));
			}
		}
		// The sub-object itself might be a class with ClassGeneratedBy
		if (UClass* RefClass = Cast<UClass>(SubObj))
		{
			if (RefClass->ClassGeneratedBy)
			{
				if (UBlueprint* RefBP = Cast<UBlueprint>(RefClass->ClassGeneratedBy))
				{
					OutRefs.AddUnique(FSoftObjectPath(RefBP));
				}
			}
		}
	}
	if (PinType.PinValueType.TerminalSubCategoryObject.IsValid())
	{
		UObject* SubObj = PinType.PinValueType.TerminalSubCategoryObject.Get();
		if (UClass* RefClass = Cast<UClass>(SubObj))
		{
			if (RefClass->ClassGeneratedBy)
			{
				if (UBlueprint* RefBP = Cast<UBlueprint>(RefClass->ClassGeneratedBy))
				{
					OutRefs.AddUnique(FSoftObjectPath(RefBP));
				}
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Blueprint extraction
// ---------------------------------------------------------------------------

bool UBlueprintExtractorLibrary::ExtractBlueprintToJson(UBlueprint* Blueprint, const FString& OutputPath, EBlueprintExtractionScope Scope)
{
	if (!Blueprint)
	{
		UE_LOG(LogBlueprintExtractor, Error, TEXT("ExtractBlueprintToJson: null Blueprint"));
		return false;
	}

	TSharedPtr<FJsonObject> JsonRoot = ExtractBlueprintToJsonObject(Blueprint, Scope);
	if (!JsonRoot)
	{
		return false;
	}

	if (WriteJsonToFile(JsonRoot, OutputPath))
	{
		UE_LOG(LogBlueprintExtractor, Log, TEXT("Extracted Blueprint '%s' to '%s'"), *Blueprint->GetName(), *OutputPath);
		return true;
	}

	UE_LOG(LogBlueprintExtractor, Error, TEXT("Failed to write JSON to '%s'"), *OutputPath);
	return false;
}

bool UBlueprintExtractorLibrary::ExtractBlueprintToJsonString(UBlueprint* Blueprint, FString& OutJsonString, EBlueprintExtractionScope Scope)
{
	if (!Blueprint)
	{
		return false;
	}

	TSharedPtr<FJsonObject> JsonRoot = ExtractBlueprintToJsonObject(Blueprint, Scope);
	if (!JsonRoot)
	{
		return false;
	}

	const UBlueprintExtractorSettings* Settings = UBlueprintExtractorSettings::Get();

	if (Settings->bPrettyPrint)
	{
		TSharedRef<TJsonWriter<TCHAR, TPrettyJsonPrintPolicy<TCHAR>>> Writer =
			TJsonWriterFactory<TCHAR, TPrettyJsonPrintPolicy<TCHAR>>::Create(&OutJsonString);
		FJsonSerializer::Serialize(JsonRoot.ToSharedRef(), Writer);
	}
	else
	{
		TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer =
			TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&OutJsonString);
		FJsonSerializer::Serialize(JsonRoot.ToSharedRef(), Writer);
	}

	return true;
}

TSharedPtr<FJsonObject> UBlueprintExtractorLibrary::ExtractBlueprintToJsonObject(UBlueprint* Blueprint, EBlueprintExtractionScope Scope)
{
	if (!Blueprint)
	{
		return nullptr;
	}

	TSharedPtr<FJsonObject> Root = MakeShared<FJsonObject>();
	Root->SetStringField(TEXT("schemaVersion"), TEXT("1.0.0"));

	TSharedPtr<FJsonObject> BPObj = MakeShared<FJsonObject>();

	// Asset info
	BPObj->SetStringField(TEXT("assetPath"), Blueprint->GetPathName());
	BPObj->SetStringField(TEXT("assetName"), Blueprint->GetName());
	BPObj->SetStringField(TEXT("blueprintType"), FBlueprintJsonSchema::BlueprintTypeToString(Blueprint->BlueprintType));

	// Class level (always included)
	BPObj->SetObjectField(TEXT("classLevel"), FClassLevelExtractor::Extract(Blueprint));

	if (Scope == EBlueprintExtractionScope::ClassLevel)
	{
		Root->SetObjectField(TEXT("blueprint"), BPObj);
		return Root;
	}

	// Variables
	BPObj->SetArrayField(TEXT("variables"), FVariableExtractor::Extract(Blueprint));

	if (Scope == EBlueprintExtractionScope::Variables)
	{
		Root->SetObjectField(TEXT("blueprint"), BPObj);
		return Root;
	}

	// Components
	TSharedPtr<FJsonObject> Components = FComponentExtractor::Extract(Blueprint);
	if (Components)
	{
		BPObj->SetObjectField(TEXT("components"), Components);
	}

	if (Scope == EBlueprintExtractionScope::Components)
	{
		Root->SetObjectField(TEXT("blueprint"), BPObj);
		return Root;
	}

	// Timelines
	BPObj->SetArrayField(TEXT("timelines"), FTimelineExtractor::Extract(Blueprint));

	// Delegates (extracted from variables with delegate pin types)
	TArray<TSharedPtr<FJsonValue>> Delegates;
	for (const FBPVariableDescription& Var : Blueprint->NewVariables)
	{
		if (Var.VarType.PinCategory == UEdGraphSchema_K2::PC_MCDelegate ||
			Var.VarType.PinCategory == UEdGraphSchema_K2::PC_Delegate)
		{
			TSharedPtr<FJsonObject> DelegateObj = MakeShared<FJsonObject>();
			DelegateObj->SetStringField(TEXT("name"), Var.VarName.ToString());
			DelegateObj->SetBoolField(TEXT("isMulticast"), Var.VarType.PinCategory == UEdGraphSchema_K2::PC_MCDelegate);
			DelegateObj->SetObjectField(TEXT("type"), FBlueprintJsonSchema::SerializePinType(Var.VarType));

			// Delegate signature from the referenced function
			if (Var.VarType.PinSubCategoryObject.IsValid())
			{
				if (UFunction* SigFunc = Cast<UFunction>(Var.VarType.PinSubCategoryObject.Get()))
				{
					TArray<TSharedPtr<FJsonValue>> SigInputs;
					TArray<TSharedPtr<FJsonValue>> SigOutputs;

					for (TFieldIterator<FProperty> PropIt(SigFunc); PropIt; ++PropIt)
					{
						FProperty* Param = *PropIt;
						if (!Param->HasAnyPropertyFlags(CPF_Parm))
						{
							continue;
						}

						TSharedPtr<FJsonObject> ParamObj = MakeShared<FJsonObject>();
						ParamObj->SetStringField(TEXT("name"), Param->GetName());
						ParamObj->SetStringField(TEXT("cppType"), Param->GetCPPType());

						if (Param->HasAnyPropertyFlags(CPF_ReturnParm | CPF_OutParm))
						{
							SigOutputs.Add(MakeShared<FJsonValueObject>(ParamObj));
						}
						else
						{
							SigInputs.Add(MakeShared<FJsonValueObject>(ParamObj));
						}
					}

					DelegateObj->SetArrayField(TEXT("signatureInputs"), SigInputs);
					DelegateObj->SetArrayField(TEXT("signatureOutputs"), SigOutputs);
				}
			}

			Delegates.Add(MakeShared<FJsonValueObject>(DelegateObj));
		}
	}
	BPObj->SetArrayField(TEXT("delegates"), Delegates);

	// Graphs
	if (Scope == EBlueprintExtractionScope::FunctionsShallow)
	{
		TArray<TSharedPtr<FJsonValue>> ShallowFunctions;
		for (const UEdGraph* Graph : Blueprint->FunctionGraphs)
		{
			if (Graph)
			{
				TSharedPtr<FJsonObject> FuncObj = MakeShared<FJsonObject>();
				FuncObj->SetStringField(TEXT("graphName"), Graph->GetName());
				FuncObj->SetStringField(TEXT("graphType"), TEXT("FunctionGraph"));
				ShallowFunctions.Add(MakeShared<FJsonValueObject>(FuncObj));
			}
		}
		for (const UEdGraph* Graph : Blueprint->UbergraphPages)
		{
			if (Graph)
			{
				TSharedPtr<FJsonObject> FuncObj = MakeShared<FJsonObject>();
				FuncObj->SetStringField(TEXT("graphName"), Graph->GetName());
				FuncObj->SetStringField(TEXT("graphType"), TEXT("EventGraph"));
				ShallowFunctions.Add(MakeShared<FJsonValueObject>(FuncObj));
			}
		}
		BPObj->SetArrayField(TEXT("functions"), ShallowFunctions);
	}
	else
	{
		BPObj->SetArrayField(TEXT("functions"), FGraphExtractor::ExtractAllGraphs(Blueprint));
	}

	// Bytecode (optional)
	if (Scope == EBlueprintExtractionScope::FullWithBytecode)
	{
		BPObj->SetObjectField(TEXT("bytecode"), FBytecodeExtractor::Extract(Blueprint));
	}

	Root->SetObjectField(TEXT("blueprint"), BPObj);
	return Root;
}

// ---------------------------------------------------------------------------
// StateTree extraction
// ---------------------------------------------------------------------------

bool UBlueprintExtractorLibrary::ExtractStateTreeToJson(UStateTree* StateTree, const FString& OutputPath)
{
	if (!StateTree)
	{
		UE_LOG(LogBlueprintExtractor, Error, TEXT("ExtractStateTreeToJson: null StateTree"));
		return false;
	}

	TSharedPtr<FJsonObject> JsonRoot = ExtractStateTreeToJsonObject(StateTree);
	if (!JsonRoot)
	{
		return false;
	}

	if (WriteJsonToFile(JsonRoot, OutputPath))
	{
		UE_LOG(LogBlueprintExtractor, Log, TEXT("Extracted StateTree '%s' to '%s'"), *StateTree->GetName(), *OutputPath);
		return true;
	}

	UE_LOG(LogBlueprintExtractor, Error, TEXT("Failed to write JSON to '%s'"), *OutputPath);
	return false;
}

TSharedPtr<FJsonObject> UBlueprintExtractorLibrary::ExtractStateTreeToJsonObject(UStateTree* StateTree)
{
	return FStateTreeExtractor::Extract(StateTree);
}

// ---------------------------------------------------------------------------
// Cascade extraction — reference collection
// ---------------------------------------------------------------------------

TArray<FSoftObjectPath> UBlueprintExtractorLibrary::CollectBlueprintReferences(const UBlueprint* Blueprint)
{
	TArray<FSoftObjectPath> Refs;
	if (!Blueprint)
	{
		return Refs;
	}

	// 1. Parent class (if Blueprint-based)
	if (Blueprint->ParentClass && Blueprint->ParentClass->ClassGeneratedBy)
	{
		if (UBlueprint* ParentBP = Cast<UBlueprint>(Blueprint->ParentClass->ClassGeneratedBy))
		{
			Refs.AddUnique(FSoftObjectPath(ParentBP));
		}
	}

	// 2. Implemented interfaces (Blueprint interfaces)
	for (const FBPInterfaceDescription& Iface : Blueprint->ImplementedInterfaces)
	{
		if (Iface.Interface && Iface.Interface->ClassGeneratedBy)
		{
			if (UBlueprint* InterfaceBP = Cast<UBlueprint>(Iface.Interface->ClassGeneratedBy))
			{
				Refs.AddUnique(FSoftObjectPath(InterfaceBP));
			}
		}
	}

	// 3. Variable types referencing Blueprint classes
	for (const FBPVariableDescription& Var : Blueprint->NewVariables)
	{
		CollectRefsFromPinType(Var.VarType, Refs);
	}

	// 4. Graph node pin references (DefaultObject and PinType sub-categories)
	auto ScanGraphs = [&](const auto& Graphs)
	{
		for (const auto& Graph : Graphs)
		{
			if (!Graph)
			{
				continue;
			}
			for (const UEdGraphNode* Node : Graph->Nodes)
			{
				if (!Node)
				{
					continue;
				}
				for (const UEdGraphPin* Pin : Node->Pins)
				{
					if (!Pin)
					{
						continue;
					}
					if (Pin->DefaultObject)
					{
						if (UBlueprint* RefBP = Cast<UBlueprint>(Pin->DefaultObject))
						{
							Refs.AddUnique(FSoftObjectPath(RefBP));
						}
						else if (UClass* RefClass = Cast<UClass>(Pin->DefaultObject))
						{
							if (RefClass->ClassGeneratedBy)
							{
								if (UBlueprint* ClassBP = Cast<UBlueprint>(RefClass->ClassGeneratedBy))
								{
									Refs.AddUnique(FSoftObjectPath(ClassBP));
								}
							}
						}
						else if (UStateTree* RefST = Cast<UStateTree>(Pin->DefaultObject))
						{
							Refs.AddUnique(FSoftObjectPath(RefST));
						}
					}
					CollectRefsFromPinType(Pin->PinType, Refs);
				}
			}
		}
	};

	ScanGraphs(Blueprint->FunctionGraphs);
	ScanGraphs(Blueprint->UbergraphPages);
	ScanGraphs(Blueprint->MacroGraphs);

	// 5. Component classes (Blueprint-based components)
	if (Blueprint->SimpleConstructionScript)
	{
		for (USCS_Node* Node : Blueprint->SimpleConstructionScript->GetAllNodes())
		{
			if (Node && Node->ComponentClass && Node->ComponentClass->ClassGeneratedBy)
			{
				if (UBlueprint* RefBP = Cast<UBlueprint>(Node->ComponentClass->ClassGeneratedBy))
				{
					Refs.AddUnique(FSoftObjectPath(RefBP));
				}
			}
		}
	}

	return Refs;
}

TArray<FSoftObjectPath> UBlueprintExtractorLibrary::CollectStateTreeReferences(const UStateTree* StateTree)
{
	TArray<FSoftObjectPath> Refs;
	if (!StateTree)
	{
		return Refs;
	}

#if WITH_EDITORONLY_DATA
	const UStateTreeEditorData* EditorData = Cast<UStateTreeEditorData>(StateTree->EditorData);
	if (!EditorData)
	{
		return Refs;
	}

	auto CollectFromNodes = [&](const TArray<FStateTreeEditorNode>& Nodes)
	{
		for (const FStateTreeEditorNode& Node : Nodes)
		{
			if (Node.InstanceObject && Node.InstanceObject->GetClass()->ClassGeneratedBy)
			{
				if (UBlueprint* RefBP = Cast<UBlueprint>(Node.InstanceObject->GetClass()->ClassGeneratedBy))
				{
					Refs.AddUnique(FSoftObjectPath(RefBP));
				}
			}
		}
	};

	TFunction<void(const UStateTreeState*)> ScanState = [&](const UStateTreeState* State)
	{
		if (!State)
		{
			return;
		}

		// Linked asset (another StateTree)
		if (State->Type == EStateTreeStateType::LinkedAsset && State->LinkedAsset)
		{
			Refs.AddUnique(FSoftObjectPath(State->LinkedAsset.Get()));
		}

		// Tasks, enter conditions, considerations
		CollectFromNodes(State->Tasks);
		CollectFromNodes(State->EnterConditions);
		CollectFromNodes(State->Considerations);

		// Single task
		if (State->SingleTask.InstanceObject && State->SingleTask.InstanceObject->GetClass()->ClassGeneratedBy)
		{
			if (UBlueprint* RefBP = Cast<UBlueprint>(State->SingleTask.InstanceObject->GetClass()->ClassGeneratedBy))
			{
				Refs.AddUnique(FSoftObjectPath(RefBP));
			}
		}

		// Transition conditions
		for (const FStateTreeTransition& Trans : State->Transitions)
		{
			CollectFromNodes(Trans.Conditions);
		}

		// Recurse into children
		for (const UStateTreeState* Child : State->Children)
		{
			ScanState(Child);
		}
	};

	// Global evaluators and tasks
	CollectFromNodes(EditorData->Evaluators);
	CollectFromNodes(EditorData->GlobalTasks);

	// All states
	for (const UStateTreeState* State : EditorData->SubTrees)
	{
		ScanState(State);
	}
#endif

	return Refs;
}

// ---------------------------------------------------------------------------
// Cascade extraction — BFS loop
// ---------------------------------------------------------------------------

int32 UBlueprintExtractorLibrary::ExtractWithCascade(const TArray<UObject*>& InitialAssets, const FString& OutputDir, EBlueprintExtractionScope Scope, int32 MaxDepth)
{
	struct FPendingAsset
	{
		UObject* Asset;
		int32 Depth;
	};

	TSet<FString> Visited;
	TArray<FPendingAsset> Queue;

	// Seed with initial assets at depth 0
	for (UObject* Asset : InitialAssets)
	{
		if (!Asset)
		{
			continue;
		}
		FString AssetPath = Asset->GetPathName();
		if (!Visited.Contains(AssetPath))
		{
			Visited.Add(AssetPath);
			Queue.Add({Asset, 0});
		}
	}

	int32 SuccessCount = 0;
	int32 ProcessIndex = 0;

	while (ProcessIndex < Queue.Num())
	{
		FPendingAsset Current = Queue[ProcessIndex++];

		const FString FileName = Current.Asset->GetName() + TEXT(".json");
		const FString FullPath = OutputDir / FileName;

		bool bSuccess = false;
		TArray<FSoftObjectPath> Refs;

		if (UBlueprint* BP = Cast<UBlueprint>(Current.Asset))
		{
			bSuccess = ExtractBlueprintToJson(BP, FullPath, Scope);
			if (Current.Depth < MaxDepth)
			{
				Refs = CollectBlueprintReferences(BP);
			}
		}
		else if (UStateTree* ST = Cast<UStateTree>(Current.Asset))
		{
			bSuccess = ExtractStateTreeToJson(ST, FullPath);
			if (Current.Depth < MaxDepth)
			{
				Refs = CollectStateTreeReferences(ST);
			}
		}

		if (bSuccess)
		{
			SuccessCount++;
			if (Current.Depth > 0)
			{
				UE_LOG(LogBlueprintExtractor, Log, TEXT("  Cascade [depth %d]: %s"), Current.Depth, *Current.Asset->GetName());
			}
		}

		// Enqueue discovered references
		for (const FSoftObjectPath& Ref : Refs)
		{
			FString RefPath = Ref.ToString();
			if (Visited.Contains(RefPath))
			{
				continue;
			}
			Visited.Add(RefPath);

			UObject* RefAsset = Ref.TryLoad();
			if (RefAsset && (Cast<UBlueprint>(RefAsset) || Cast<UStateTree>(RefAsset)))
			{
				Queue.Add({RefAsset, Current.Depth + 1});
			}
		}
	}

	return SuccessCount;
}
