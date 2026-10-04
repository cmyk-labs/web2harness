; The application owns integration/data cleanup. NSIS owns installed files and shortcuts.
; Helper resources are embedded in the uninstaller, independent of the installed runtime.
!ifdef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  !include FileFunc.nsh
  Var W2HPurge
  Var W2HPurgeCheckbox
  Var W2HPrepared
  Var W2HOwnerPid
  LangString W2HTitle 1033 "Uninstall Web2Harness"
  LangString W2HTitle 2052 "卸载 Web2Harness"
  LangString W2HDescription 1033 "Remove the application and disconnect its Codex integration."
  LangString W2HDescription 2052 "卸载应用，并解除其与 Codex 的连接。"
  LangString W2HChoice 1033 "Also delete all Web2Harness local data"
  LangString W2HChoice 2052 "同时删除 Web2Harness 的全部本地数据"
  LangString W2HDetails 1033 "Includes settings, browser sign-in, cache, logs and installed runtimes. Codex sign-in, chats, projects and unrelated settings are preserved. Finish Web2Harness tasks and choose Exit in its tray menu before continuing."
  LangString W2HDetails 2052 "包括设置、内置浏览器登录状态、缓存、日志及运行时。保留 Codex 登录、聊天、项目及其他配置。请先结束 Web2Harness 任务，并从托盘菜单退出应用。"
  LangString W2HFailure 1033 "Uninstall could not complete. No further files will be removed. Resolve the following issue and retry:"
  LangString W2HFailure 2052 "卸载未能完成，已停止后续删除。请处理以下问题后重试："

  !macro customUnInit
    ${If} $W2HPurge == ""
      StrCpy $W2HPurge "0"
    ${EndIf}
    System::Call 'kernel32::GetCurrentProcessId() i.r9'
    StrCpy $W2HOwnerPid $9
    ; Do not allow NSIS's generic AppData deletion to bypass ownership checks.
    ${GetParameters} $0
    ClearErrors
    ${GetOptions} $0 "--delete-app-data" $1
    ${IfNot} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "Use the uninstall window to choose data cleanup. / 请在卸载窗口选择数据清理。" /SD IDOK
      SetErrorLevel 1
      Quit
    ${EndIf}
  !macroend

  !macro customUnWelcomePage
    ; Expand functions only after electron-builder registers its NSIS plugins and MUI.
    UninstPage custom un.W2HOptions un.W2HOptionsLeave

  Function un.W2HOptions
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "$(W2HTitle)" "$(W2HDescription)"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateCheckbox} 0 10u 100% 20u "$(W2HChoice)"
    Pop $W2HPurgeCheckbox
    ${NSD_SetState} $W2HPurgeCheckbox $W2HPurge
    ${NSD_CreateLabel} 0 40u 100% 90u "$(W2HDetails)"
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function un.W2HOptionsLeave
    ${NSD_GetState} $W2HPurgeCheckbox $W2HPurge
  FunctionEnd

  Function un.W2HPrepare
    ${GetParameters} $0
    ClearErrors
    ${GetOptions} $0 "--delete-app-data" $1
    ${IfNot} ${Errors}
      SetErrorLevel 1
      Abort
    ${EndIf}
    ${If} ${isUpdated}
      Return
    ${EndIf}
    ${If} $W2HPrepared == "1"
      Return
    ${EndIf}
    ; Silent uninstalls can enter here before customUnInit. Default to retaining data.
    ${If} $W2HOwnerPid == ""
      System::Call 'kernel32::GetCurrentProcessId() i.r9'
      StrCpy $W2HOwnerPid $9
      StrCpy $W2HPurge "0"
    ${EndIf}
    InitPluginsDir
    SetOutPath "$PLUGINSDIR\web2harness-uninstall"
    File /oname=bun.exe "${PROJECT_DIR}\build\runtime\runtime\bun.exe"
    File /oname=uninstall.cjs "${PROJECT_DIR}\build\uninstall\uninstall.cjs"
    nsExec::ExecToStack /TIMEOUT=180000 '"$PLUGINSDIR\web2harness-uninstall\bun.exe" "$PLUGINSDIR\web2harness-uninstall\uninstall.cjs" prepare --install-root "$INSTDIR" --app-data "$APPDATA" --local-app-data "$LOCALAPPDATA" --owner-pid "$W2HOwnerPid" --purge "$W2HPurge"'
    Pop $0
    Pop $1
    ${If} $0 != "0"
      SetDetailsView show
      DetailPrint "$1"
      MessageBox MB_OK|MB_ICONSTOP "$(W2HFailure)$\r$\n$\r$\n$1" /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
    StrCpy $W2HPrepared "1"
  FunctionEnd
  !macroend

  !macro customCheckAppRunning
    ; Never force-kill the launcher by image name. The helper checks the exact installation.
    Call un.W2HPrepare
  !macroend

  !macro customUnInstall
    Call un.W2HPrepare
  !macroend

  !macro customRemoveFiles
      ; Use electron-builder's own atomic move/restore functions for both uninstall
      ; and upgrade. Busy files must leave the uninstall registration available for retry.
      CreateDirectory "$PLUGINSDIR\old-install"
      Push ""
      Call un.atomicRMDir
      Pop $R0
      ${If} $R0 != 0
        DetailPrint "File is busy, aborting: $R0"
        Push ""
        Call un.restoreFiles
        Pop $R0
        SetErrorLevel 1
        Abort "Close applications using Web2Harness files and retry."
      ${EndIf}
      SetOutPath $TEMP
      RMDir /r $INSTDIR
      ${IfNot} ${isUpdated}
        nsExec::ExecToStack /TIMEOUT=30000 '"$PLUGINSDIR\web2harness-uninstall\bun.exe" "$PLUGINSDIR\web2harness-uninstall\uninstall.cjs" finish --install-root "$INSTDIR" --app-data "$APPDATA" --local-app-data "$LOCALAPPDATA"'
        Pop $0
        Pop $1
        ${If} $0 != "0"
          SetDetailsView show
          DetailPrint "$1"
          MessageBox MB_OK|MB_ICONSTOP "$(W2HFailure)$\r$\n$\r$\n$1" /SD IDOK
          SetErrorLevel 1
          Abort
        ${EndIf}
      ${EndIf}
  !macroend
!else
  Var W2HSetupOwnerPid
  Var W2HSetupStarted
  LangString W2HPreparing 1033 "Preparing and verifying application components..."
  LangString W2HPreparing 2052 "正在准备并校验应用运行组件..."
  LangString W2HSetupFailure 1033 "Installation did not complete. See the details below."
  LangString W2HSetupFailure 2052 "安装未完成，请查看以下详情。"
  LangString W2HRecoveryFailure 1033 "Automatic recovery did not complete. Recovery files were retained. Run this installer again before starting Web2Harness."
  LangString W2HRecoveryFailure 2052 "自动恢复未完成，已保留恢复文件。请重新运行本安装程序后再启动 Web2Harness。"

  !macro customHeader
    Function W2HSetupRollback
      ${If} $W2HSetupStarted == "1"
        SetOutPath "$PLUGINSDIR\web2harness-setup"
        nsExec::ExecToStack /TIMEOUT=600000 '"$PLUGINSDIR\web2harness-setup\bun.exe" "$PLUGINSDIR\web2harness-setup\install.cjs" rollback --install-root "$INSTDIR" --app-data "$APPDATA" --local-app-data "$LOCALAPPDATA" --owner-pid "$W2HSetupOwnerPid" --version "${VERSION}"'
        Pop $0
        Pop $1
        ${If} $0 == "0"
          StrCpy $W2HSetupStarted "0"
        ${Else}
          DetailPrint "$1"
          MessageBox MB_OK|MB_ICONSTOP "$(W2HRecoveryFailure)$\r$\n$1" /SD IDOK
        ${EndIf}
      ${EndIf}
    FunctionEnd

    Function .onInstFailed
      Call W2HSetupRollback
      SetErrorLevel 1
    FunctionEnd

    Function .onGUIEnd
      Call W2HSetupRollback
    FunctionEnd

    Function W2HSetupBegin
      ${If} $W2HSetupStarted == "1"
        Return
      ${EndIf}
      ${GetParameters} $0
      ClearErrors
      ${GetOptions} $0 "--delete-app-data" $1
      ${IfNot} ${Errors}
        SetErrorLevel 1
        Abort "Use the uninstaller window to choose data cleanup."
      ${EndIf}
      ${If} $installMode != "CurrentUser"
        SetErrorLevel 1
        Abort "Web2Harness setup requires the current-user installation context."
      ${EndIf}
      System::Call 'kernel32::GetCurrentProcessId() i.r9'
      StrCpy $W2HSetupOwnerPid $9
      InitPluginsDir
      SetOutPath "$PLUGINSDIR\web2harness-setup"
      File /oname=bun.exe "${PROJECT_DIR}\build\runtime\runtime\bun.exe"
      File /oname=install.cjs "${PROJECT_DIR}\build\uninstall\install.cjs"
      SetDetailsView show
      SetDetailsPrint both
      DetailPrint "$(W2HPreparing)"
      StrCpy $W2HSetupStarted "1"
      nsExec::ExecToStack /TIMEOUT=600000 '"$PLUGINSDIR\web2harness-setup\bun.exe" "$PLUGINSDIR\web2harness-setup\install.cjs" begin --install-root "$INSTDIR" --app-data "$APPDATA" --local-app-data "$LOCALAPPDATA" --owner-pid "$W2HSetupOwnerPid" --version "${VERSION}"'
      Pop $0
      Pop $1
      ${If} $0 != "0"
        DetailPrint "$1"
        MessageBox MB_OK|MB_ICONSTOP "$(W2HSetupFailure)$\r$\n$1" /SD IDOK
        Call W2HSetupRollback
        SetErrorLevel 1
        Abort
      ${EndIf}
    FunctionEnd
  !macroend

  !macro customCheckAppRunning
    ; Runs before NSIS removes the previous version. Do not terminate active tasks by image name.
    Call W2HSetupBegin
  !macroend

  !macro customInstall
    SetOutPath "$PLUGINSDIR\web2harness-setup"
    SetDetailsView show
    SetDetailsPrint both
    DetailPrint "$(W2HPreparing)"
    nsExec::ExecToStack /TIMEOUT=600000 '"$PLUGINSDIR\web2harness-setup\bun.exe" "$PLUGINSDIR\web2harness-setup\install.cjs" commit --install-root "$INSTDIR" --app-data "$APPDATA" --local-app-data "$LOCALAPPDATA" --owner-pid "$W2HSetupOwnerPid" --version "${VERSION}"'
    Pop $0
    Pop $1
    ${If} $0 != "0"
      DetailPrint "$1"
      MessageBox MB_OK|MB_ICONSTOP "$(W2HSetupFailure)$\r$\n$1" /SD IDOK
      Call W2HSetupRollback
      SetErrorLevel 1
      Abort
    ${EndIf}
    StrCpy $W2HSetupStarted "0"
  !macroend

  !macro customUnInstallCheck
    ${If} ${Errors}
    ${OrIf} $R0 != 0
      Call W2HSetupRollback
      SetErrorLevel 1
      Abort "The previous version could not be replaced."
    ${EndIf}
  !macroend
!endif
