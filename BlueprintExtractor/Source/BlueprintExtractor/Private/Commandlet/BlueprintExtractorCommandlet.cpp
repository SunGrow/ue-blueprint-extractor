#include "Commandlet/BlueprintExtractorCommandlet.h"

#include "BlueprintExtractorSubsystem.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Editor.h"
#include "Policies/CondensedJsonPrintPolicy.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UObject/UnrealType.h"

#include <iostream>
#include <string>

DEFINE_LOG_CATEGORY_STATIC(LogBPECommandlet, Log, All);

namespace
{
bool IsInputParameter(const FProperty* Prop)
{
	if (!Prop || Prop->HasAnyPropertyFlags(CPF_ReturnParm))
	{
		return false;
	}

	return !Prop->HasAnyPropertyFlags(CPF_OutParm) || Prop->HasAnyPropertyFlags(CPF_ReferenceParm);
}

FString ToSnakeCase(const FString& Name)
{
	FString Result;
	Result.Reserve(Name.Len() + 4);

	for (int32 Index = 0; Index < Name.Len(); ++Index)
	{
		const TCHAR Ch = Name[Index];
		if (FChar::IsUpper(Ch))
		{
			if (Index > 0)
			{
				Result.AppendChar(TEXT('_'));
			}
			Result.AppendChar(FChar::ToLower(Ch));
		}
		else
		{
			Result.AppendChar(Ch);
		}
	}

	return Result;
}

bool SetPropertyValueFromString(FProperty* Prop, uint8* ParamBuffer, const FString& Value)
{
	if (const FStrProperty* StrProp = CastField<FStrProperty>(Prop))
	{
		StrProp->SetPropertyValue_InContainer(ParamBuffer, Value);
		return true;
	}
	if (const FBoolProperty* BoolProp = CastField<FBoolProperty>(Prop))
	{
		BoolProp->SetPropertyValue_InContainer(ParamBuffer, FCString::ToBool(*Value));
		return true;
	}
	if (const FIntProperty* IntProp = CastField<FIntProperty>(Prop))
	{
		IntProp->SetPropertyValue_InContainer(ParamBuffer, FCString::Atoi(*Value));
		return true;
	}
	if (const FFloatProperty* FloatProp = CastField<FFloatProperty>(Prop))
	{
		FloatProp->SetPropertyValue_InContainer(ParamBuffer, FCString::Atof(*Value));
		return true;
	}
	if (const FDoubleProperty* DoubleProp = CastField<FDoubleProperty>(Prop))
	{
		DoubleProp->SetPropertyValue_InContainer(ParamBuffer, FCString::Atod(*Value));
		return true;
	}

	return false;
}

bool SetPropertyValueFromJson(FProperty* Prop, uint8* ParamBuffer, const TSharedPtr<FJsonValue>& JsonValue)
{
	if (!JsonValue.IsValid())
	{
		return false;
	}

	if (const FStrProperty* StrProp = CastField<FStrProperty>(Prop))
	{
		StrProp->SetPropertyValue_InContainer(ParamBuffer, JsonValue->AsString());
		return true;
	}
	if (const FBoolProperty* BoolProp = CastField<FBoolProperty>(Prop))
	{
		BoolProp->SetPropertyValue_InContainer(ParamBuffer, JsonValue->AsBool());
		return true;
	}
	if (const FIntProperty* IntProp = CastField<FIntProperty>(Prop))
	{
		IntProp->SetPropertyValue_InContainer(ParamBuffer, static_cast<int32>(JsonValue->AsNumber()));
		return true;
	}
	if (const FFloatProperty* FloatProp = CastField<FFloatProperty>(Prop))
	{
		FloatProp->SetPropertyValue_InContainer(ParamBuffer, static_cast<float>(JsonValue->AsNumber()));
		return true;
	}
	if (const FDoubleProperty* DoubleProp = CastField<FDoubleProperty>(Prop))
	{
		DoubleProp->SetPropertyValue_InContainer(ParamBuffer, JsonValue->AsNumber());
		return true;
	}

	return false;
}

void ApplyReflectedDefaultValue(UFunction* Func, FProperty* Prop, uint8* ParamBuffer)
{
	const FString MetadataKey = FString::Printf(TEXT("CPP_Default_%s"), *Prop->GetName());
	if (!Func->HasMetaData(*MetadataKey))
	{
		return;
	}

	const FString& DefaultValue = Func->GetMetaData(*MetadataKey);
	if (!SetPropertyValueFromString(Prop, ParamBuffer, DefaultValue))
	{
		UE_LOG(LogBPECommandlet, Warning, TEXT("Unsupported default parameter type for %s.%s"), *Func->GetName(), *Prop->GetName());
	}
}

bool TryGetJsonParamValue(const TSharedPtr<FJsonObject>& Params, FProperty* Prop, TSharedPtr<FJsonValue>& OutValue)
{
	const FString PropName = Prop->GetName();
	if (Params->HasField(PropName))
	{
		OutValue = Params->TryGetField(PropName);
		return OutValue.IsValid();
	}

	const FString SnakeName = ToSnakeCase(PropName);
	if (Params->HasField(SnakeName))
	{
		OutValue = Params->TryGetField(SnakeName);
		return OutValue.IsValid();
	}

	if (CastField<FBoolProperty>(Prop) && PropName.Len() > 1 && PropName[0] == TCHAR('b') && FChar::IsUpper(PropName[1]))
	{
		const FString BoolAlias = ToSnakeCase(PropName.RightChop(1));
		if (Params->HasField(BoolAlias))
		{
			OutValue = Params->TryGetField(BoolAlias);
			return OutValue.IsValid();
		}
	}

	return false;
}

FString CompactJsonPayloadForLineProtocol(const FString& Json)
{
	TSharedPtr<FJsonValue> Value;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Json);
	if (FJsonSerializer::Deserialize(Reader, Value) && Value.IsValid())
	{
		FString CompactJson;
		const TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer =
			TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&CompactJson);
		if (FJsonSerializer::Serialize(Value.ToSharedRef(), TEXT(""), Writer))
		{
			return CompactJson;
		}
	}

	FString CompactJson = Json;
	CompactJson.ReplaceInline(TEXT("\r"), TEXT(""));
	CompactJson.ReplaceInline(TEXT("\n"), TEXT(""));
	return CompactJson;
}

FString EscapeJsonStringForLineProtocol(const FString& Value)
{
	FString Escaped = Value;
	Escaped.ReplaceInline(TEXT("\\"), TEXT("\\\\"));
	Escaped.ReplaceInline(TEXT("\""), TEXT("\\\""));
	Escaped.ReplaceInline(TEXT("\r"), TEXT("\\r"));
	Escaped.ReplaceInline(TEXT("\n"), TEXT("\\n"));
	Escaped.ReplaceInline(TEXT("\t"), TEXT("\\t"));
	return Escaped;
}
}

UBlueprintExtractorCommandlet::UBlueprintExtractorCommandlet()
{
	IsClient = false;
	IsEditor = true; // Load editor-only assets (DataAssets, Blueprints, etc.)
	IsServer = false;
	LogToConsole = false;
}

int32 UBlueprintExtractorCommandlet::Main(const FString& Params)
{
	UE_LOG(LogBPECommandlet, Log, TEXT("BlueprintExtractor commandlet starting."));

	UBlueprintExtractorSubsystem* Subsystem = GEditor
		? GEditor->GetEditorSubsystem<UBlueprintExtractorSubsystem>()
		: nullptr;
	if (!IsValid(Subsystem))
	{
		UE_LOG(LogBPECommandlet, Warning, TEXT("Editor subsystem collection did not provide UBlueprintExtractorSubsystem; falling back to a transient instance."));
		Subsystem = NewObject<UBlueprintExtractorSubsystem>();
	}
	if (!IsValid(Subsystem))
	{
		UE_LOG(LogBPECommandlet, Error, TEXT("Failed to create UBlueprintExtractorSubsystem instance."));
		return 1;
	}

	// Signal readiness to the MCP CommandletAdapter. UE may emit log lines to
	// stdout before this envelope; the adapter filters for JSON-RPC frames.
	WriteStdout(TEXT("{\"jsonrpc\":\"2.0\",\"id\":0,\"result\":{\"ready\":true}}"));

	// Read JSON-RPC requests from stdin, one per line
	std::string StdLine;
	while (std::getline(std::cin, StdLine))
	{
		if (StdLine.empty())
		{
			continue;
		}

		const FString Line = UTF8_TO_TCHAR(StdLine.c_str());
		const FString Response = ProcessRequest(Subsystem, Line);
		WriteStdout(Response);
	}

	UE_LOG(LogBPECommandlet, Log, TEXT("BlueprintExtractor commandlet finished (stdin closed)."));
	return 0;
}

void UBlueprintExtractorCommandlet::WriteStdout(const FString& Line)
{
	const FTCHARToUTF8 Utf8(*Line);
	std::cout << Utf8.Get() << std::endl;
	std::cout.flush();
}

FString UBlueprintExtractorCommandlet::ProcessRequest(
	UBlueprintExtractorSubsystem* Subsystem,
	const FString& RequestJson)
{
	// Parse JSON-RPC envelope
	TSharedPtr<FJsonObject> Envelope;
	{
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(RequestJson);
		if (!FJsonSerializer::Deserialize(Reader, Envelope) || !Envelope.IsValid())
		{
			return MakeJsonRpcError(-1, TEXT("Failed to parse JSON-RPC request"));
		}
	}

	const int64 Id = static_cast<int64>(Envelope->GetNumberField(TEXT("id")));
	const FString Method = Envelope->GetStringField(TEXT("method"));

	if (Method.IsEmpty())
	{
		return MakeJsonRpcError(Id, TEXT("Missing 'method' field"));
	}

	const TSharedPtr<FJsonObject>* ParamsPtr = nullptr;
	TSharedPtr<FJsonObject> Params;
	if (Envelope->TryGetObjectField(TEXT("params"), ParamsPtr) && ParamsPtr && ParamsPtr->IsValid())
	{
		Params = *ParamsPtr;
	}
	else
	{
		Params = MakeShared<FJsonObject>();
	}

	const FString ResultJson = InvokeViaReflection(Subsystem, Method, Params);
	return MakeJsonRpcResult(Id, ResultJson);
}

FString UBlueprintExtractorCommandlet::InvokeViaReflection(
	UBlueprintExtractorSubsystem* Subsystem,
	const FString& MethodName,
	const TSharedPtr<FJsonObject>& Params)
{
	UFunction* Func = Subsystem->FindFunction(FName(*MethodName));
	if (!Func)
	{
		return FString::Printf(TEXT("{\"error\":\"Method not found: %s\"}"), *MethodName);
	}

	// Allocate parameter buffer
	const int32 ParamsSize = Func->ParmsSize;
	uint8* ParamBuffer = static_cast<uint8*>(FMemory::Malloc(ParamsSize));
	FMemory::Memzero(ParamBuffer, ParamsSize);

	// Initialize default values
	for (TFieldIterator<FProperty> It(Func); It; ++It)
	{
		FProperty* Prop = *It;
		Prop->InitializeValue_InContainer(ParamBuffer);
		if (IsInputParameter(Prop))
		{
			ApplyReflectedDefaultValue(Func, Prop, ParamBuffer);
		}
	}

	// Map JSON params to UFUNCTION parameters
	for (TFieldIterator<FProperty> It(Func); It; ++It)
	{
		FProperty* Prop = *It;

		if (!IsInputParameter(Prop))
		{
			continue;
		}

		TSharedPtr<FJsonValue> JsonValue;
		if (!TryGetJsonParamValue(Params, Prop, JsonValue))
		{
			// Parameter not provided: use reflected CPP_Default_* metadata when present,
			// otherwise keep the type-initialized value.
			continue;
		}

		if (!SetPropertyValueFromJson(Prop, ParamBuffer, JsonValue))
		{
			UE_LOG(LogBPECommandlet, Warning, TEXT("Unsupported JSON parameter type for %s.%s"), *Func->GetName(), *Prop->GetName());
		}
	}

	// Call the function
	Subsystem->ProcessEvent(Func, ParamBuffer);

	// Read return value
	FString ReturnValue;
	for (TFieldIterator<FProperty> It(Func); It; ++It)
	{
		if (It->HasAnyPropertyFlags(CPF_ReturnParm))
		{
			if (const FStrProperty* RetProp = CastField<FStrProperty>(*It))
			{
				ReturnValue = RetProp->GetPropertyValue_InContainer(ParamBuffer);
			}
			break;
		}
	}

	// Cleanup
	for (TFieldIterator<FProperty> It(Func); It; ++It)
	{
		It->DestroyValue_InContainer(ParamBuffer);
	}
	FMemory::Free(ParamBuffer);

	// If the method returned a JSON string, use it directly as the result
	if (ReturnValue.StartsWith(TEXT("{")) || ReturnValue.StartsWith(TEXT("[")))
	{
		return ReturnValue;
	}

	// Wrap non-JSON return values
	if (ReturnValue.IsEmpty())
	{
		return TEXT("{\"success\":true}");
	}

	return FString::Printf(TEXT("{\"result\":\"%s\"}"), *EscapeJsonStringForLineProtocol(ReturnValue));
}

FString UBlueprintExtractorCommandlet::MakeJsonRpcResult(int64 Id, const FString& ResultJson)
{
	const FString ResultPayload = CompactJsonPayloadForLineProtocol(ResultJson);
	return FString::Printf(TEXT("{\"jsonrpc\":\"2.0\",\"id\":%lld,\"result\":%s}"), Id, *ResultPayload);
}

FString UBlueprintExtractorCommandlet::MakeJsonRpcError(int64 Id, const FString& Message)
{
	return FString::Printf(TEXT("{\"jsonrpc\":\"2.0\",\"id\":%lld,\"error\":\"%s\"}"), Id, *EscapeJsonStringForLineProtocol(Message));
}
