# BlueprintExtractor Commandlet — TDD

## Проблема

MCP-сторона полностью реализована (CommandletAdapter, AdaptiveExecutor, LazyCommandletAdapter, ExecutionModeDetector), но C++ commandlet-класса `UBlueprintExtractorCommandlet` в UE-плагине не существует. Запуск `UnrealEditor-Cmd -run=blueprintextractor` падает — движок не находит командлет.

## Решение

Создать `UBlueprintExtractorCommandlet` — UE commandlet, который:
1. Запускается через `UnrealEditor-Cmd <project> -run=BlueprintExtractor -stdin`
2. Читает JSON-RPC запросы из stdin (по одному на строку)
3. Маршрутизирует вызовы к `UBlueprintExtractorSubsystem` через UE Reflection
4. Пишет JSON-RPC ответы в stdout

## Протокол (определён MCP CommandletAdapter)

### Startup
- Командлет стартует, выводит JSON в stdout → MCP считает процесс готовым

### Request (stdin → commandlet)
```json
{"jsonrpc":"2.0","id":1,"method":"ExtractStateTree","params":{"AssetPath":"/Game/..."}}
```

### Response (commandlet → stdout)
```json
{"jsonrpc":"2.0","id":1,"result":{...}}
```
или
```json
{"jsonrpc":"2.0","id":1,"error":"message"}
```

### Shutdown
- MCP закрывает stdin → `std::getline` возвращает false → commandlet завершается

## Маршрутизация через Reflection

Вместо ручного dispatch-table, используем UE Reflection:
1. Создаём экземпляр `UBlueprintExtractorSubsystem` как обычный UObject
2. `FindFunction(MethodName)` → UFunction*
3. Итерируем `TFieldIterator<FProperty>` для маппинга JSON params → param struct
4. `ProcessEvent(Func, ParamBuffer)` → вызов метода
5. Читаем возвращаемое значение (FString) из param struct

Поддерживаемые типы параметров: `FString`, `bool`, `int32`, `float/double`.

## Что поддерживается

Все UFUNCTIONы из `UBlueprintExtractorSubsystem`. MCP-сторона уже фильтрует по tool mode annotations — `editor_only` тулы не маршрутизируются в commandlet.

## Файлы

| Файл | Описание |
|---|---|
| `Private/Commandlet/BlueprintExtractorCommandlet.h` | Header с UCLASS |
| `Private/Commandlet/BlueprintExtractorCommandlet.cpp` | Реализация: stdin loop, JSON-RPC, reflection dispatch |
