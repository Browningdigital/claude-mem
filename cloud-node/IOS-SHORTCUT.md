# iPhone Shortcut: Dispatch Claude Code Task

Create an iOS Shortcut that lets you dispatch tasks to your cloud node from anywhere on your iPhone.

## Setup

1. Open **Shortcuts** app on iPhone
2. Tap **+** to create new shortcut
3. Name it: **"Claude Task"**

## Shortcut Steps

### Step 1: Ask for Input
- Action: **Ask for Input**
- Question: "What should Claude do?"
- Input Type: Text

### Step 2: Get Contents of URL
- Action: **Get Contents of URL**
- URL: `https://cloud-node-dispatcher.devin-b58.workers.dev/task`
- Method: **POST**
- Headers:
  - `Authorization`: `Bearer YOUR_TASK_AUTH_TOKEN`
  - `Content-Type`: `application/json`
- Request Body (JSON):
  ```json
  {
    "prompt": "[Provided Input]",
    "timeout_minutes": 30,
    "skip_permissions": true
  }
  ```

### Step 3: Get Dictionary Value
- Action: **Get Dictionary Value**
- Key: `task_id`

### Step 4: Show Result
- Action: **Show Result**
- Text: "Task dispatched: [Dictionary Value]"

## Usage

- Say **"Hey Siri, Claude Task"**
- Or add to Home Screen as a widget
- Or trigger from Share Sheet

## Check Task Status Shortcut

Create a second shortcut **"Claude Status"**:

1. **Ask for Input**: "Task ID?"
2. **Get Contents of URL**: `GET https://cloud-node-dispatcher.devin-b58.workers.dev/task/[Provided Input]`
   - Header: `Authorization: Bearer YOUR_TASK_AUTH_TOKEN`
3. **Get Dictionary Value**: Key `task` → then key `status`
4. **If** status equals "completed":
   - **Get Dictionary Value**: Key `task` → then key `output`
   - **Show Result**: output
5. **Otherwise**:
   - **Show Result**: "Status: [status]"

## Tips

- Add the dispatch shortcut to your Lock Screen for instant access
- Use the Automation tab to schedule recurring tasks (e.g., daily code quality scans)
- You can also trigger shortcuts from the Claude iOS app conversation by pasting the curl command
