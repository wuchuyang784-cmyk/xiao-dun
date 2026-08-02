// 工具市场类 schema：install_tool / uninstall_tool / list_tools / manage_tool_factory
export const agentsSchemas = {
  install_tool: {
    type: 'function',
    function: {
      name: 'install_tool',
      description: 'Directly install a new tool and register it for future turns. This is a high-risk direct path: for tools you wrote yourself, prefer manage_tool_factory propose -> review -> install so runtime checks and tests gate the install. Tool code is an async function body with variables args and helpers. helpers.fetch and helpers.exec require explicit permissions.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '工具名称，只能含小写字母、数字、下划线，以字母开头，长度 2-50。如 "weather_query"。'
          },
          description: {
            type: 'string',
            description: '工具描述：说明这个工具做什么、何时该调用它。'
          },
          parameters_schema: {
            type: 'object',
            description: 'JSON Schema 对象，描述工具的输入参数。格式：{ "type": "object", "properties": { ... }, "required": [...] }'
          },
          code: {
            type: 'string',
            description: 'async 函数体代码（不含 async function 声明头）。示例：const { text } = args; return text.trim();'
          },
          permissions: {
            type: 'object',
            description: 'Optional capability declaration. Defaults to { network:false, exec:false }. Set network:true only when helpers.fetch is required. Set exec:true only for explicitly user-approved tools that must run shell commands.',
            properties: {
              network: { type: 'boolean', description: 'Allow helpers.fetch / network access.' },
              exec: { type: 'boolean', description: 'Allow helpers.exec shell command execution.' }
            }
          }
        },
        required: ['name', 'description', 'parameters_schema', 'code']
      }
    }
  },

  manage_tool_factory: {
    type: 'function',
    function: {
      name: 'manage_tool_factory',
      description: 'Managed tool factory for self-authored function-call tools. Use this instead of direct install_tool when you write a tool yourself. Flow: action="propose" with schema/code/tests -> action="review" to run runtime safety checks and tests -> action="install" only if approved. Review sees only the artifact package and deterministic policy/test results, not the builder context.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['propose', 'review', 'install', 'get', 'list', 'delete'],
            description: 'Factory action.'
          },
          proposal_id: {
            type: 'string',
            description: 'Proposal id returned by propose. Required for review/install/get/delete.'
          },
          name: {
            type: 'string',
            description: 'Tool name for propose: lowercase letters, digits, underscores, 2-50 chars, starts with a letter.'
          },
          description: {
            type: 'string',
            description: 'Tool description for propose: what the tool does and when to call it.'
          },
          parameters_schema: {
            type: 'object',
            description: 'JSON Schema object for tool input parameters. Required for propose.'
          },
          permissions: {
            type: 'object',
            description: 'Capability declaration. Managed generated tools default to no network and no exec; exec is rejected by the managed review gate.',
            properties: {
              network: { type: 'boolean', description: 'Request network access. Tests still run with network disabled.' },
              exec: { type: 'boolean', description: 'Request shell execution. Managed review rejects this in the first version.' }
            }
          },
          code: {
            type: 'string',
            description: 'async function body using args and helpers. Do not include function wrapper. Must return a string or JSON-serializable result.'
          },
          tests: {
            type: 'array',
            description: 'Required for propose. Runtime tests run in a separate Node process with network/exec disabled. Each test can assert exact result, substring, or parsed JSON.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Test name.' },
                args: { type: 'object', description: 'Arguments passed to the generated tool.' },
                expect: { description: 'Exact expected raw return value.' },
                expected_result: { description: 'Alias for expect.' },
                expect_contains: { type: 'string', description: 'Substring expected in the raw return value.' },
                expect_json: { type: 'object', description: 'Expected parsed JSON object if the tool returns JSON text.' }
              }
            }
          }
        },
        required: ['action']
      }
    }
  },

  uninstall_tool: {
    type: 'function',
    function: {
      name: 'uninstall_tool',
      description: '卸载一个已安装的工具，立即生效，同时删除其持久化文件。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '要卸载的工具名称。'
          }
        },
        required: ['name']
      }
    }
  },

  list_tools: {
    type: 'function',
    function: {
      name: 'list_tools',
      description: '列出所有可用工具（内置 + 已安装），含名称、描述、来源。适合安装前确认是否已存在、或排查工具问题。',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
}
