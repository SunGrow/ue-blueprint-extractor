#include "Extractors/BehaviorTreeExtractor.h"

#include "BlueprintExtractorVersion.h"
#include "BehaviorTree/BlackboardData.h"
#include "PropertySerializer.h"
#include "BehaviorTree/BTCompositeNode.h"
#include "BehaviorTree/BTDecorator.h"
#include "BehaviorTree/BTNode.h"
#include "BehaviorTree/BTService.h"
#include "BehaviorTree/BTTaskNode.h"
#include "BehaviorTree/BehaviorTree.h"

namespace BehaviorTreeExtractorInternal
{

static FString DecoratorLogicToString(const EBTDecoratorLogic::Type Operation)
{
	switch (Operation)
	{
	case EBTDecoratorLogic::Test:
		return TEXT("Test");
	case EBTDecoratorLogic::And:
		return TEXT("And");
	case EBTDecoratorLogic::Or:
		return TEXT("Or");
	case EBTDecoratorLogic::Not:
		return TEXT("Not");
	default:
		return TEXT("Invalid");
	}
}

static TSharedPtr<FJsonObject> MakeNodeObject(const UBTNode* Node, int32& NextNodeIndex)
{
	if (!Node)
	{
		return nullptr;
	}

	TSharedPtr<FJsonObject> NodeObject = MakeShared<FJsonObject>();
	NodeObject->SetStringField(TEXT("nodeClass"), Node->GetClass()->GetName());
	NodeObject->SetStringField(TEXT("nodeClassPath"), Node->GetClass()->GetPathName());
	NodeObject->SetStringField(TEXT("nodeName"), Node->GetNodeName());
	NodeObject->SetNumberField(TEXT("nodeIndex"), NextNodeIndex++);
	NodeObject->SetNumberField(TEXT("executionIndex"), Node->GetExecutionIndex());
	NodeObject->SetNumberField(TEXT("treeDepth"), Node->GetTreeDepth());

	const TSharedPtr<FJsonObject> Properties = FPropertySerializer::SerializePropertyOverrides(Node);
	if (Properties.IsValid() && Properties->Values.Num() > 0)
	{
		NodeObject->SetObjectField(TEXT("properties"), Properties);
	}

	return NodeObject;
}

} // namespace BehaviorTreeExtractorInternal

TSharedPtr<FJsonObject> FBehaviorTreeExtractor::Extract(const UBehaviorTree* BehaviorTree)
{
	if (!BehaviorTree)
	{
		return nullptr;
	}

	TSharedPtr<FJsonObject> Root = MakeShared<FJsonObject>();
	Root->SetStringField(TEXT("schemaVersion"), BlueprintExtractor::SchemaVersion);

	TSharedPtr<FJsonObject> BehaviorTreeObject = MakeShared<FJsonObject>();
	BehaviorTreeObject->SetStringField(TEXT("assetPath"), BehaviorTree->GetPathName());
	BehaviorTreeObject->SetStringField(TEXT("assetName"), BehaviorTree->GetName());

	if (BehaviorTree->BlackboardAsset)
	{
		BehaviorTreeObject->SetStringField(TEXT("blackboardAsset"), BehaviorTree->BlackboardAsset->GetPathName());
	}

	int32 NextNodeIndex = 0;
	if (BehaviorTree->RootNode)
	{
		TSharedPtr<FJsonObject> RootNode = ExtractCompositeNode(BehaviorTree->RootNode, NextNodeIndex);
		if (RootNode.IsValid())
		{
			RootNode->SetArrayField(TEXT("decorators"), ExtractDecoratorNodes(BehaviorTree->RootDecorators, NextNodeIndex));
			RootNode->SetArrayField(TEXT("decoratorLogic"), ExtractDecoratorLogic(BehaviorTree->RootDecoratorOps));
			BehaviorTreeObject->SetObjectField(TEXT("rootNode"), RootNode);
		}
	}

	Root->SetObjectField(TEXT("behaviorTree"), BehaviorTreeObject);
	return Root;
}

TSharedPtr<FJsonObject> FBehaviorTreeExtractor::ExtractNode(const UBTNode* Node, int32& NextNodeIndex)
{
	if (const UBTCompositeNode* CompositeNode = Cast<UBTCompositeNode>(Node))
	{
		return ExtractCompositeNode(CompositeNode, NextNodeIndex);
	}

	return BehaviorTreeExtractorInternal::MakeNodeObject(Node, NextNodeIndex);
}

TSharedPtr<FJsonObject> FBehaviorTreeExtractor::ExtractCompositeNode(const UBTCompositeNode* CompositeNode, int32& NextNodeIndex)
{
	TSharedPtr<FJsonObject> NodeObject = BehaviorTreeExtractorInternal::MakeNodeObject(CompositeNode, NextNodeIndex);
	if (!NodeObject.IsValid())
	{
		return nullptr;
	}

	TArray<TSharedPtr<FJsonValue>> Services;
	for (const TObjectPtr<UBTService>& Service : CompositeNode->Services)
	{
		if (Service)
		{
			if (const TSharedPtr<FJsonObject> ServiceObject = ExtractNode(Service, NextNodeIndex))
			{
				Services.Add(MakeShared<FJsonValueObject>(ServiceObject));
			}
		}
	}
	NodeObject->SetArrayField(TEXT("services"), Services);

	TArray<TSharedPtr<FJsonValue>> Children;
	for (const FBTCompositeChild& Child : CompositeNode->Children)
	{
		const UBTNode* ChildNode = Child.ChildComposite
			? static_cast<const UBTNode*>(Child.ChildComposite.Get())
			: static_cast<const UBTNode*>(Child.ChildTask.Get());
		if (!ChildNode)
		{
			continue;
		}

		const TSharedPtr<FJsonObject> ChildObject = ExtractNode(ChildNode, NextNodeIndex);
		if (!ChildObject.IsValid())
		{
			continue;
		}

		ChildObject->SetArrayField(TEXT("decorators"), ExtractDecoratorNodes(Child.Decorators, NextNodeIndex));
		ChildObject->SetArrayField(TEXT("decoratorLogic"), ExtractDecoratorLogic(Child.DecoratorOps));
		Children.Add(MakeShared<FJsonValueObject>(ChildObject));
	}
	NodeObject->SetArrayField(TEXT("children"), Children);

	return NodeObject;
}

TArray<TSharedPtr<FJsonValue>> FBehaviorTreeExtractor::ExtractDecoratorNodes(const TArray<TObjectPtr<UBTDecorator>>& Decorators, int32& NextNodeIndex)
{
	TArray<TSharedPtr<FJsonValue>> DecoratorArray;

	for (const TObjectPtr<UBTDecorator>& Decorator : Decorators)
	{
		if (!Decorator)
		{
			continue;
		}

		if (const TSharedPtr<FJsonObject> DecoratorObject = ExtractNode(Decorator, NextNodeIndex))
		{
			DecoratorArray.Add(MakeShared<FJsonValueObject>(DecoratorObject));
		}
	}

	return DecoratorArray;
}

TArray<TSharedPtr<FJsonValue>> FBehaviorTreeExtractor::ExtractDecoratorLogic(const TArray<FBTDecoratorLogic>& DecoratorOps)
{
	TArray<TSharedPtr<FJsonValue>> LogicArray;

	for (const FBTDecoratorLogic& DecoratorOp : DecoratorOps)
	{
		TSharedPtr<FJsonObject> LogicObject = MakeShared<FJsonObject>();
		LogicObject->SetStringField(TEXT("operation"), BehaviorTreeExtractorInternal::DecoratorLogicToString(DecoratorOp.Operation));
		LogicObject->SetNumberField(TEXT("number"), DecoratorOp.Number);
		LogicArray.Add(MakeShared<FJsonValueObject>(LogicObject));
	}

	return LogicArray;
}
