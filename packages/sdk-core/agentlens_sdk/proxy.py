from typing import Any, Callable, Dict, Optional
import os

class ToolExecutionProxy:
    """
    A runtime shield that intercepts tool executions.
    Depending on the current branch (e.g. root vs experimental),
    it can mock the tool, run it in a sandbox, or execute it normally.
    """

    def __init__(self, mode: str = "allow"):
        """
        :param mode: 'allow' (normal), 'mock' (dry-run), 'sandbox' (isolated)
        """
        self.mode = mode
        # Can be overridden by environment variable for branch-specific overrides
        env_mode = os.environ.get("AGENTLENS_TOOL_MODE")
        if env_mode in ["allow", "mock", "sandbox"]:
            self.mode = env_mode

    def execute(
        self, 
        tool_func: Callable, 
        tool_name: str, 
        args: tuple, 
        kwargs: Dict[str, Any]
    ) -> Any:
        if self.mode == "mock":
            return f"Mocked execution of {tool_name} with args={args} kwargs={kwargs}"
        
        if self.mode == "sandbox":
            # For a real sandbox, this would dispatch to a containerized environment (e.g., Docker, Firecracker).
            # For MVP, we restrict dangerous commands if it's a shell tool.
            if tool_name == "execute_command" or tool_name == "shell":
                cmd = kwargs.get("command", "") or (args[0] if args else "")
                if any(dangerous in cmd for dangerous in ["rm -rf", "mkfs", "sudo"]):
                    raise PermissionError(f"Command '{cmd}' is blocked in sandbox mode.")
            return tool_func(*args, **kwargs)
        
        # 'allow' mode - execute normally
        return tool_func(*args, **kwargs)

    def wrap_tool(self, tool_func: Callable, tool_name: Optional[str] = None) -> Callable:
        """
        Wraps a tool function with the proxy.
        """
        name = tool_name or tool_func.__name__

        def wrapper(*args, **kwargs):
            return self.execute(tool_func, name, args, kwargs)
        
        return wrapper
