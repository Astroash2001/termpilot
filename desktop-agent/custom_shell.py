import os
import sys
import subprocess
import traceback

def main():
    # ANSI Colors
    COLOR_USER = "\033[96m"   # Cyan
    COLOR_AI = "\033[92m"     # Green
    COLOR_ERROR = "\033[91m"  # Red
    COLOR_RESET = "\033[0m"
    
    print(f"{COLOR_AI}=== TermPilot Custom Shell ==={COLOR_RESET}")
    print(f"Type your commands below. Your input is Cyan, output is Green.\n")

    while True:
        try:
            # 1. Print Prompt in Cyan
            cwd = os.getcwd()
            sys.stdout.write(f"\n{COLOR_USER}[{cwd}] > ")
            sys.stdout.flush()
            
            # Read user input
            command = input()
            command = command.strip()
            
            if not command:
                continue
                
            if command.lower() in ['exit', 'quit']:
                break
                
            if command.lower() == 'clear':
                os.system('cls' if os.name == 'nt' else 'clear')
                continue
                
            # Handle directory changes natively in the python shell
            if command.startswith("cd "):
                target_dir = command[3:].strip()
                try:
                    os.chdir(target_dir)
                except Exception as e:
                    print(f"{COLOR_ERROR}cd error: {e}{COLOR_RESET}")
                continue

            # 2. Switch to AI/Output color (Green)
            sys.stdout.write(COLOR_AI)
            sys.stdout.flush()
            
            # 3. Execute command using a sub-shell so PATH and standard tools work
            # We use shell=True to allow things like "dir" or "echo"
            process = subprocess.Popen(
                command,
                shell=True,
                cwd=cwd
            )
            process.wait()
            
            # 4. Reset color back to normal
            sys.stdout.write(COLOR_RESET)
            sys.stdout.flush()
            
        except EOFError:
            break
        except KeyboardInterrupt:
            print(f"{COLOR_RESET}\n^C")
        except Exception as e:
            print(f"{COLOR_ERROR}Shell Error: {e}{COLOR_RESET}")

if __name__ == "__main__":
    # Disable python output buffering
    os.environ["PYTHONUNBUFFERED"] = "1"
    main()
