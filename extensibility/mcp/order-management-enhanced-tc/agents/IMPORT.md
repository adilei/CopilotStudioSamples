# Importing the Agent Solutions

## Prerequisites

- A Power Platform environment with Copilot Studio
- The MCP connectors deployed (see `scripts/deploy-connectors.mjs`)
- Admin or Maker role in the target environment

## Steps

### 1. Deploy connectors first

The agents reference custom connectors for the MCP servers. Deploy them before importing:

```bash
node scripts/deploy-connectors.mjs <environment-id> <order-tunnel-url> <warehouse-tunnel-url>
```

### 2. Import the solution

1. Go to [make.powerapps.com](https://make.powerapps.com)
2. Select your target environment
3. Navigate to **Solutions** > **Import solution**
4. Upload `solution/OrdersAgent.zip`
5. When prompted for **Connection References**, click **New connection** for the Order Management MCP connector
6. Select the connection you just created
7. Click **Import**
8. Repeat for `solution/WarehouseAgent.zip` with the Warehouse connector

### 3. Create connections (no auth)

The MCP connectors have no authentication. Creating a connection is just clicking **Create** with no credentials.

### 4. Configure the Gradio UI

Copy `chat-ui/.env.sample` to `chat-ui/.env` and fill in:

```env
COPILOTSTUDIOAGENT__ENVIRONMENTID=<your-environment-id>
COPILOTSTUDIOAGENT__SCHEMANAME=<agent-schema-name>
COPILOTSTUDIOAGENT__TENANTID=<your-tenant-id>
COPILOTSTUDIOAGENT__AGENTAPPID=<app-registration-client-id>
```

Find the schema name in Copilot Studio under the agent's **Settings** > **Advanced** > **Schema name**.

#### App Registration setup

The Gradio chat UI authenticates via MSAL interactive login. You need an Entra ID App Registration:

1. Go to **portal.azure.com** > **App registrations** > **New registration**
2. Name: e.g., "MCP Demo Chat Client"
3. Supported account types: **Single tenant**
4. Redirect URI: **Public client/native** > `http://localhost`
5. After creation, go to **API permissions** > **Add a permission** > **APIs my organization uses**
6. Search for **CopilotStudio** > select **CopilotStudio.Copilots.Invoke** (delegated)
7. Click **Grant admin consent**
8. Copy the **Application (client) ID** — this is your `COPILOTSTUDIOAGENT__AGENTAPPID`

### 5. Publish agents

In Copilot Studio, open each agent and click **Publish** to make the latest version live.
