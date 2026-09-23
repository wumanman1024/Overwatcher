; 安装目录策略：
;   首次安装 → 落到 D:\localforge
;   覆盖/升级安装 → 复用注册表里记录的原安装目录，原地覆盖，不再强推 D:\localforge
;
; 背景：electron-builder 在 initMultiUser 阶段已从注册表把旧 $INSTDIR 恢复好，
; 但原先的 customInit 无条件 StrCpy $INSTDIR "D:\localforge"，把它抹掉了——
; 结果覆盖安装会把新版本装到 D:\localforge，旧目录残留成孤儿。
;
; customInit 插入在 .onInit 中 initMultiUser 之后（见 electron-builder 的 installer.nsi），
; 此刻 perMachine 路径已从 HKLM 恢复了旧 $INSTDIR。这里再自行读一次注册表判定是否已安装，
; 与时序解耦，更稳。HKLM / HKCU 两个键都查：分别对应「为所有用户安装」与「仅当前用户安装」。
!macro customInit
  ReadRegStr $R0 HKLM "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  StrCmp $R0 "" 0 custom_keep_instdir
  ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  StrCmp $R0 "" 0 custom_keep_instdir
  ; 两个键都为空 = 本机从未安装过，才落到默认目录。
  StrCpy $INSTDIR "D:\localforge"
  Goto custom_instdir_done
  custom_keep_instdir:
  ; 已安装：$INSTDIR 保持脚本稍后从注册表恢复的原目录，实现原地覆盖升级。
  custom_instdir_done:
!macroend
