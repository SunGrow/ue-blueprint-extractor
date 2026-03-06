#include "Extractors/DataTableExtractor.h"
#include "BlueprintExtractorModule.h"
#include "Engine/DataTable.h"

TSharedPtr<FJsonObject> FDataTableExtractor::Extract(const UDataTable* DataTable)
{
	if (!ensureMsgf(DataTable, TEXT("DataTableExtractor: null DataTable")))
	{
		return nullptr;
	}

	TSharedPtr<FJsonObject> Root = MakeShared<FJsonObject>();
	Root->SetStringField(TEXT("schemaVersion"), TEXT("1.0.0"));

	TSharedPtr<FJsonObject> DTObj = MakeShared<FJsonObject>();
	DTObj->SetStringField(TEXT("assetPath"), DataTable->GetPathName());
	DTObj->SetStringField(TEXT("assetName"), DataTable->GetName());

	// Row struct info
	const UScriptStruct* RowStruct = DataTable->GetRowStruct();
	if (RowStruct)
	{
		DTObj->SetStringField(TEXT("rowStructType"), RowStruct->GetPathName());
		DTObj->SetStringField(TEXT("rowStructName"), RowStruct->GetName());

		// Schema: property definitions from the row struct
		TArray<TSharedPtr<FJsonValue>> Schema;
		for (TFieldIterator<FProperty> PropIt(RowStruct); PropIt; ++PropIt)
		{
			FProperty* Property = *PropIt;
			if (Property->HasAnyPropertyFlags(CPF_Deprecated))
			{
				continue;
			}

			TSharedPtr<FJsonObject> ColObj = MakeShared<FJsonObject>();
			ColObj->SetStringField(TEXT("name"), Property->GetName());
			ColObj->SetStringField(TEXT("cppType"), Property->GetCPPType());
			Schema.Add(MakeShared<FJsonValueObject>(ColObj));
		}
		DTObj->SetArrayField(TEXT("schema"), Schema);
	}

	// Rows
	const TMap<FName, uint8*>& RowMap = DataTable->GetRowMap();
	DTObj->SetNumberField(TEXT("rowCount"), RowMap.Num());

	TArray<TSharedPtr<FJsonValue>> Rows;
	for (const TPair<FName, uint8*>& RowPair : RowMap)
	{
		TSharedPtr<FJsonObject> RowObj = MakeShared<FJsonObject>();
		RowObj->SetStringField(TEXT("rowName"), RowPair.Key.ToString());

		if (RowStruct && RowPair.Value)
		{
			TArray<TSharedPtr<FJsonValue>> RowProperties;
			for (TFieldIterator<FProperty> PropIt(RowStruct); PropIt; ++PropIt)
			{
				FProperty* Property = *PropIt;
				if (Property->HasAnyPropertyFlags(CPF_Deprecated | CPF_Transient))
				{
					continue;
				}

				TSharedPtr<FJsonObject> PropObj = MakeShared<FJsonObject>();
				PropObj->SetStringField(TEXT("name"), Property->GetName());

				FString ValueStr;
				Property->ExportText_InContainer(0, ValueStr, RowPair.Value, nullptr, nullptr, PPF_None);
				PropObj->SetStringField(TEXT("value"), ValueStr);

				RowProperties.Add(MakeShared<FJsonValueObject>(PropObj));
			}
			RowObj->SetArrayField(TEXT("properties"), RowProperties);
		}

		Rows.Add(MakeShared<FJsonValueObject>(RowObj));
	}
	DTObj->SetArrayField(TEXT("rows"), Rows);

	Root->SetObjectField(TEXT("dataTable"), DTObj);
	return Root;
}
