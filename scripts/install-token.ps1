# The token wrapper depended on the former private runtime/service installer.
param([Parameter(Mandatory = $true, Position = 0)][string]$Token)
throw 'Token installer retired. Run install.ps1 to install the plugin, then sign in from Harness Remote (or /remote login in dsh-TUI).'
