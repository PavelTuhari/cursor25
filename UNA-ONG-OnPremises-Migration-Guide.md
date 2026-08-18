# UNA.md/ONG — On-Premises Deployment & Migration Guide
## Oracle Free Tier Edition

**Version:** 1.0  
**Date:** August 2026  
**Audience:** Technical deployment team, System administrators  
**Target:** Moldovan Cybersecurity Agency (Agenția pentru Securitatea Cibernetică)  
**Scope:** Migration from OCI PaaS to on-premises two-server infrastructure

---

## 1. Executive Summary

This guide covers the complete migration and deployment of **UNA.md/ONG** from Oracle Cloud Infrastructure (OCI PaaS) to an on-premises environment using **Oracle Database 23c Free Tier** (available for Linux). The deployment topology uses two servers: one dedicated database server and one for the UNA.md application layer.

**Key Characteristics of On-Premises Deployment:**
- Zero cloud infrastructure costs; 100% internal management
- Oracle Free Tier (23c/21c) with no license fees
- Native Windows client (Embarcadero Delphi) connects via encrypted TCP/IP to database server
- Network isolated from cloud; all data remains on-premises
- Full operational control; vendor support shifts from managed to advisory

**Timeline Estimate:** 10–15 business days (depends on data volume and team experience)  
**Migration Risk:** Low (read-only preparation phase, validated rollback)

---

## 2. Hardware Requirements

### 2.1 Database Server
**Role:** Oracle Database 23c Free Tier host + application data repository

| Component | Specification | Rationale |
|-----------|---|---|
| **OS** | Oracle Linux 8.x or Red Hat Enterprise Linux 8.x (x86_64) | Oracle Free Tier official support; Linux-only for Free Tier |
| **CPU** | 4 cores (minimum 2.5 GHz) | Oracle Free Tier limit: 4 cores; 2 cores for DB engine, 2 for OS/buffers |
| **RAM** | 8 GB (minimum); 16 GB recommended | Free Tier: 4 GB database SGA recommended + 4 GB OS cache. 16 GB allows comfortable buffer/temp space |
| **Storage** | 100 GB SSD (for data + backups) | Free Tier: 20 GB data, 50 GB backups, 30 GB OS/logs/temp. Scale up if historical data load >5 years |
| **Network** | 1 Gbps NIC (dedicated for app-to-DB traffic) | Secure internal network; no internet exposure required |
| **UPS** | Recommended | Ensures graceful shutdown on power loss; protects Open Transactions |

**Baseline Configuration (CyberSecurity Agency):**
- **Hostname:** `una-db-01.internal.gov.md`
- **IP Address:** `10.x.x.50` (internal LAN, static)
- **DNS/Reverse DNS:** Configured for internal domain
- **Firewall Rules:** Inbound port 1521 (Oracle) from app server only; SSH port 22 for admin only

---

### 2.2 Application Server
**Role:** UNA.md service layer + Oracle client libraries + reporting engine

| Component | Specification | Rationale |
|-----------|---|---|
| **OS** | Windows Server 2019/2022 (x64) | Native UNA.md Embarcadero Delphi application requires Windows; Linux port not available |
| **CPU** | 4 cores (2.5 GHz minimum) | Application server workload: UI rendering, report generation, file I/O |
| **RAM** | 8 GB (minimum); 12 GB recommended | OS + application heap + client libraries + concurrent user sessions |
| **Storage** | 150 GB SSD | OS (50 GB), application binaries (5 GB), report cache/temp (30 GB), historical archives (65 GB) |
| **Network** | 1 Gbps NIC + VPN (recommended) | Encrypted tunnel to database server; optional VPN for remote admin access |
| **Software Clients** | Oracle Instant Client 23c (or matching DB version) | ODAC (Oracle Data Access Components) or Oracle Instant Client for Windows |

**Baseline Configuration:**
- **Hostname:** `una-app-01.internal.gov.md`
- **IP Address:** `10.x.x.51` (internal LAN, static)
- **Service Account:** `service_una` (non-admin, RunAs for application services)
- **Firewall Rules:** Outbound to DB port 1521 allowed; inbound RDP/SSH for admin only

---

### 2.3 Network Topology

```
[Internal LAN 10.0.0.0/16]
  │
  ├─ una-db-01 (10.x.x.50)
  │  └─ Oracle Database 23c Free Tier
  │     └─ Listening on 0.0.0.0:1521
  │
  └─ una-app-01 (10.x.x.51)
     └─ UNA.md Application Server
        └─ Oracle Instant Client
           └─ TCP connection to 10.x.x.50:1521 (encrypted)

External (Admin/Monitoring):
  │
  ├─ Admin Workstation
  │  └─ SSH to una-db-01 (port 22, restricted by IP)
  │  └─ RDP to una-app-01 (port 3389, restricted by IP)
  │
  └─ [Optional] VPN Gateway
     └─ Secure remote access for vendor support (call + screen sharing)
```

**Security Notes:**
- No direct internet exposure; database server is air-gapped from WAN
- All traffic between app and DB is unencrypted TCP/IP by default (on same LAN, acceptable; encrypt with wallet if required)
- OS-level firewall (iptables/Windows Firewall) enforces port restrictions
- SSH access to DB server: key-based authentication only, no passwords
- Application credentials stored in encrypted wallet on app server (Oracle Wallet)

---

## 3. Software Prerequisites & Versions

### 3.1 Database Server (Linux)

```bash
# OS: Oracle Linux 8.x or RHEL 8.x (x86_64)
# Kernel: 5.4.x or later
# Glibc: 2.28 or later

# Required packages:
gcc-4.8.5 or later          # C compiler for Oracle installation
glibc-2.28                  # C library
libaio-0.3.112              # Asynchronous I/O support
binutils-2.30               # Binary utilities
libstdc++-4.8.5             # C++ runtime (for some utilities)
kernel-2.6.32-754           # Kernel (check with: uname -r)
elfutils-libelf-0.176       # ELF utilities
libnsl-2.28                 # Network services library
policycoreutils-python-2.8  # SELinux tools (if SELinux enabled)
```

**Installation Commands (example for Oracle Linux 8):**
```bash
sudo yum install -y gcc glibc libaio binutils libstdc++ kernel-devel
sudo yum install -y elfutils-libelf policycoreutils-python
```

### 3.2 Application Server (Windows)

```
OS: Windows Server 2019 (KB5028786 latest patch) or Windows Server 2022
Architecture: x64

# Software stack:
1. .NET Framework 4.8 (required by some UNA.md components)
2. Visual C++ Redistributable 2019 x64 (14.28.29913)
3. Oracle Instant Client 23c Windows x64 (basic + ODAC)
4. MDAC 2.8.1 SP1 (Windows components; often pre-installed)
5. Microsoft Report Viewer (for UNA.md reporting module)
6. Windows Time Service (synchronized with DB server for audit logs)
```

**Download Links & Installation:**
- Oracle Instant Client 23c: https://www.oracle.com/database/technologies/instant-client/winx64-64-downloads.html
  - Download: `instantclient-basic-windows.x64-23.x.0.0.0.zip`
  - Extract to: `C:\oracle\instantclient_23_x`
- ODAC (Oracle Data Access Components): `ODACx64.exe` or NPM package via nuget

---

### 3.3 Supported Database Versions

| Version | Free Tier | License | Recommended |
|---------|-----------|---------|---|
| Oracle 23c | ✓ Yes | Free forever | **✓ Primary choice** |
| Oracle 21c | ✓ Yes (until Nov 2026) | Free until support ends | Alternative if 23c unavailable |
| Oracle 19c | ✗ No | Paid license | Not applicable for this guide |

**Note:** Oracle Free Tier Database does NOT support:
- Automatic backups (manual via RMAN required)
- High Availability / RAC clustering
- Advanced Security Option (encryption at rest via TDE)
- Compression

These limitations are acceptable for on-premises government deployment (internal backup strategy, single-instance resilience via OS-level redundancy).

---

## 4. Pre-Migration Preparation Checklist

### 4.1 Cloud (OCI PaaS) - Export Phase

**Timeline: 1–2 days before cutover**

- [ ] **Backup Current Instance**
  ```sql
  -- Connect to current OCI Oracle instance as SYSDBA
  RMAN> BACKUP DATABASE PLUS ARCHIVELOG;
  ```
  - Retain full backup in OCI object storage for 30 days (rollback insurance)
  - Export backup to external hard drive if >100 GB

- [ ] **Freeze Data Entry**
  - Stop all user transactions 24 hours before export
  - Communicate maintenance window to all NGO staff
  - Log all active sessions for audit trail

- [ ] **Document Current Configuration**
  ```sql
  -- Run on OCI instance to extract DDL
  SELECT DBMS_METADATA.GET_DDL('TABLE', TABLE_NAME)
    FROM DBA_TABLES WHERE OWNER = 'UNASYS' ORDER BY TABLE_NAME;
  
  -- Extract tablespace info
  SELECT * FROM DBA_TABLESPACES;
  
  -- Extract parameters
  SELECT NAME, VALUE FROM V$PARAMETER WHERE ISDEFAULT = 'N' ORDER BY NAME;
  ```

- [ ] **Extract Complete Database Dump**
  ```bash
  expdp system/password FULL=Y DIRECTORY=export_dir DUMPFILE=una_ong_full_$(date +%Y%m%d).dmp \
    LOGFILE=una_ong_export_$(date +%Y%m%d).log
  ```
  - Estimated size: 5–15 GB (depending on 5-year transaction history)
  - Estimated time: 2–6 hours on OCI (SSD-backed storage)
  - Transfer to USB 3.0 external disk (faster than network for large files)

- [ ] **Verify Export Integrity**
  ```bash
  # Check dump file size and log for errors
  ls -lah una_ong_full_*.dmp
  tail -100 una_ong_export_*.log | grep -i "error\|warning"
  ```

- [ ] **Extract Wallet (if Encrypted Connection in Use)**
  - OCI Autonomous Database: export from Secure Wallet zip
  - Copy `ewallet.p12`, `cwallet.sso`, `tnsnames.ora` to secure location on USB drive
  - Will NOT be used in on-premises setup (but keep for reference/audit)

- [ ] **Document User Permissions & Roles**
  ```sql
  SELECT * FROM DBA_ROLES WHERE ROLE LIKE 'UNA%' OR ROLE = 'DBA' ORDER BY ROLE;
  SELECT * FROM DBA_ROLE_PRIVS WHERE GRANTEE IN (SELECT USERNAME FROM DBA_USERS WHERE ACCOUNT_STATUS = 'OPEN');
  ```

- [ ] **Generate Report on Database Objects**
  ```sql
  SELECT OBJECT_TYPE, COUNT(*) FROM DBA_OBJECTS WHERE OWNER = 'UNASYS' GROUP BY OBJECT_TYPE ORDER BY 1;
  ```
  - Expected: Tables ~150, Indexes ~300, Procedures/Functions ~80, Triggers ~40, Views ~30

---

### 4.2 On-Premises - Pre-Deployment Checklist

**Timeline: 3–5 days before cutover**

- [ ] **Database Server (Linux)**
  - [ ] OS installed and patched (yum update -y)
  - [ ] Hostname configured (`una-db-01`)
  - [ ] Static IP set and DNS registered
  - [ ] NTP synchronized (ntpdate -u pool.ntp.org)
  - [ ] Firewall rules tested (port 1521 open from app server only)
  - [ ] SSH key-based login enabled (no password auth)
  - [ ] SELinux set to permissive (setenforce 0) or disabled
  - [ ] Kernel parameters tuned for Oracle:
    ```bash
    # /etc/sysctl.conf additions
    kernel.shmmax = 2147483648        # 2GB for SGA
    kernel.shmall = 524288             # in pages
    kernel.sem = 250 32000 100 128
    fs.file-max = 6815744
    net.core.rmem_max = 134217728
    net.core.wmem_max = 134217728
    ```
  - [ ] Required OS packages installed (see Section 3.1)
  - [ ] Oracle user created:
    ```bash
    groupadd -g 54321 oinstall
    useradd -u 54321 -g oinstall -d /home/oracle oracle
    mkdir -p /opt/oracle/product/23c
    chown -R oracle:oinstall /opt/oracle
    chmod -R 775 /opt/oracle
    ```

- [ ] **Application Server (Windows)**
  - [ ] OS installed, patched, and hardened
  - [ ] Hostname configured (`una-app-01`)
  - [ ] Static IP set and DNS registered
  - [ ] Windows Time Service running and synchronized with DB server
  - [ ] Windows Firewall rules tested (port 1521 outbound to DB server)
  - [ ] Network path to backup location verified (\\backup-share\una)
  - [ ] Service account created (`service_una` with limited privileges)
  - [ ] .NET Framework 4.8 installed
  - [ ] Visual C++ Redistributable 2019 x64 installed
  - [ ] Oracle Instant Client 23c extracted to C:\oracle\instantclient_23_x
  - [ ] TNSNAMES.ORA created pointing to on-premises database:
    ```
    UNASYS =
      (DESCRIPTION =
        (ADDRESS = (PROTOCOL = TCP)(HOST = 10.x.x.50)(PORT = 1521))
        (CONNECT_DATA =
          (SERVICE_NAME = UNASYS)
        )
      )
    ```
  - [ ] Connectivity test from app server to DB server:
    ```
    C:\> sqlplus system@UNASYS
    -- or via Instant Client:
    C:\> sqlplus /nolog
    SQL> CONNECT system@UNASYS
    SQL> SELECT * FROM V$VERSION;
    ```

- [ ] **Network & Security**
  - [ ] LAN cable tested between servers (ping latency <1 ms)
  - [ ] TCP port 1521 filtered at firewall (no access from WAN)
  - [ ] SSH port 22 filtered at firewall (admin IP only)
  - [ ] Windows RDP port 3389 filtered (admin IP only)
  - [ ] Backup network path accessible from both servers
  - [ ] UPS tested and battery verified (>30 min runtime)

- [ ] **Vendor Support Arrangement**
  - [ ] Support contact assigned (UNA.md support team)
  - [ ] VPN credentials prepared (if remote access needed)
  - [ ] Screen-sharing software installed (TeamViewer, AnyDesk, or similar)
  - [ ] Mobile phone number for emergency contact verified
  - [ ] Support SLA understood: 8x5 (business hours) for critical issues

---

## 5. Installation Procedures

### 5.1 Oracle Database 23c Free Tier Installation (Linux)

**Prerequisites completed:** Section 4.2 (DB Server checklist)

#### Step 1: Download Oracle Database 23c Free Tier

```bash
# On database server, as root or via sudo
cd /tmp

# Visit: https://www.oracle.com/cis/database/free/
# Download for Linux x86-64: oracle-database-free-23c-1.0-1.el8.x86_64.rpm
# (OR compile from source if RPM unavailable in region)

# Example: using wget from URL (adjust URL per release)
wget https://download.oracle.com/otn/linux/oracle23c/OracleDatabase23cFree-23.0.0.0-1.x86_64.rpm
```

#### Step 2: Install Oracle Database

```bash
# As root:
rpm -ivh OracleDatabase23cFree-23.0.0.0-1.x86_64.rpm

# Output will show:
# Installed:
#   oracle-database-free-23.0.0.0-1.x86_64
# Prerequisites:
#   /opt/oracle/product/23c

# Post-install hook runs automatically:
#   - Creates UNASYS database
#   - Generates initial parameters file
#   - Starts listener on 0.0.0.0:1521
```

**Estimated Duration:** 15–25 minutes (depends on disk I/O)

#### Step 3: Configure Oracle Environment

```bash
# As oracle user:
su - oracle

# Add to ~/.bashrc:
export ORACLE_HOME=/opt/oracle/product/23c
export ORACLE_SID=UNASYS
export PATH=$ORACLE_HOME/bin:$PATH
export LD_LIBRARY_PATH=$ORACLE_HOME/lib:$LD_LIBRARY_PATH

# Apply changes:
source ~/.bashrc

# Verify:
sqlplus -v
# Output: SQL*Plus: Release 23.0.0.0.0 - Production on [date/time]
```

#### Step 4: Start Database Instance

```bash
# As oracle user:
sqlplus / as sysdba

SQL> STARTUP;
# Database opened.
# Total System Global Area:     4294967296 bytes
# Fixed Size:                     14623296 bytes
# Variable Size:                3221225472 bytes
# Database Buffers:             1056964608 bytes
# Redo Buffers:                    2084864 bytes

SQL> SELECT NAME FROM V$DATABASE;
# NAME
# --------
# UNASYS

SQL> EXIT
```

#### Step 5: Configure Listener (1521)

```bash
# As oracle user, edit $ORACLE_HOME/network/admin/listener.ora:
LISTENER =
  (DESCRIPTION_LIST =
    (DESCRIPTION =
      (ADDRESS = (PROTOCOL = TCP)(HOST = 0.0.0.0)(PORT = 1521))
      (ADDRESS = (PROTOCOL = IPC)(KEY = EXTPROC1))
    )
  )

DEFAULT_SERVICE_LISTENER = UNASYS

# Restart listener:
lsnrctl stop
lsnrctl start

# Verify listener status:
lsnrctl status
# Output: UNASYS (DEDICATED) established:0 refused:0
```

#### Step 6: Enable Automatic Startup

```bash
# As root, create Oracle startup script:
cat > /etc/init.d/oracledb << 'EOF'
#!/bin/bash
# /etc/init.d/oracledb
# Start/stop Oracle database on boot
case "$1" in
  start)
    su - oracle -c "sqlplus / as sysdba" << SQLEOF
    STARTUP
    EXIT
SQLEOF
    ;;
  stop)
    su - oracle -c "sqlplus / as sysdba" << SQLEOF
    SHUTDOWN IMMEDIATE
    EXIT
SQLEOF
    ;;
esac
EOF

chmod +x /etc/init.d/oracledb

# For systemd systems (Oracle Linux 8):
systemctl enable oracledb
systemctl start oracledb

# Verify:
systemctl status oracledb
```

---

### 5.2 UNA.md Application Server Installation (Windows)

**Prerequisites completed:** Section 4.2 (App Server checklist)

#### Step 1: Install Oracle Instant Client

```powershell
# On application server, as Administrator

# Download from OTN or internal repository:
# instantclient-basic-windows.x64-23.3.0.0.0.zip (approx. 200 MB)

# Extract:
Expand-Archive -Path "C:\Users\Admin\Downloads\instantclient-basic-windows.x64-23.3.0.0.0.zip" `
  -DestinationPath "C:\" -Force

# Verify structure:
Get-ChildItem C:\instantclient_23_3
# Output: *.dll, *.exe files

# Add to system PATH (permanently):
[Environment]::SetEnvironmentVariable(
  "PATH",
  "$env:PATH;C:\instantclient_23_3",
  "Machine"
)

# Restart PowerShell or cmd to apply PATH
```

#### Step 2: Create TNSNAMES.ORA

```powershell
# Create network config:
# C:\instantclient_23_3\network\admin\tnsnames.ora

$tnsContent = @"
UNASYS =
  (DESCRIPTION =
    (ADDRESS = (PROTOCOL = TCP)(HOST = 10.x.x.50)(PORT = 1521))
    (CONNECT_DATA =
      (SERVICE_NAME = UNASYS)
    )
  )
"@

mkdir -Force C:\instantclient_23_3\network\admin | Out-Null
Set-Content -Path "C:\instantclient_23_3\network\admin\tnsnames.ora" -Value $tnsContent
```

#### Step 3: Test Database Connectivity

```powershell
# In Command Prompt (not PowerShell, for SQL*Plus compatibility):
cmd.exe

# Test with Instant Client SQL*Plus:
C:\> sqlplus system@UNASYS

# At prompt, enter password (will be created in Section 6.2)
# Expected output:
# SQL> SELECT NAME FROM V$DATABASE;
# NAME
# --------
# UNASYS

SQL> EXIT
```

#### Step 4: Install UNA.md Application

```powershell
# Obtain UNA.md setup package: una-ong-setup-2026-onpremises.exe (from vendor)
# Version requirement: v3.14 or later (tested on-premises)

# Run installer with admin privileges:
Start-Process -FilePath "una-ong-setup-2026-onpremises.exe" -Verb RunAs

# Installer Steps (GUI):
# 1. Accept license agreement
# 2. Installation path: C:\Program Files\UNASYS\ONG
# 3. Database connection type: Oracle (Network)
# 4. Database hostname: 10.x.x.50
# 5. Database port: 1521
# 6. Service name: UNASYS
# 7. Application service account: service_una (created earlier)
# 8. Install shortcuts for current user

# Estimated duration: 5–10 minutes
```

#### Step 5: Configure UNA.md Service

```powershell
# After installation, open Services.msc:
# Locate: "UNA.md ONG Application Server"
# Properties:
#   - Start type: Automatic (Delayed)
#   - Log on as: service_una (password entered)
#   - Recovery: Restart the service (after 5 min, then 15 min)

# Start the service:
Start-Service -Name "UNA.ONG.AppServer"

# Verify running:
Get-Service "UNA.ONG.AppServer" | Select-Object Status
# Output: Status : Running
```

#### Step 6: Verify Application Launch

```powershell
# Open UNA.md Client (Embarcadero Delphi application):
# Menu: Start → Programs → UNASYS → ONG Accounting

# First-time connection will prompt:
# - Database connection: UNASYS (from tnsnames.ora)
# - Username: SYSTEM (or any created user)
# - Password: [database password from Step 6.2]

# Verify successful connection:
# - Main window title shows: "UNA.md/ONG — Database: UNASYS@10.x.x.50"
# - Menu bar fully enabled
# - Chart of accounts visible

# Navigate: View → System Status
# Confirm: Database Version 23c, Instance Status: OPEN, Archive Mode: NOARCHIVELOG
```

---

## 6. Database Migration & Import

### 6.1 Physical Data Transfer

**Prerequisites:** Export from OCI completed (Section 4.1), dump file size ~10–15 GB

#### Option A: USB External Drive (Recommended for >5 GB)

```bash
# On OCI Linux instance (or Windows client with Linux tools):
# Step 1: Verify export dump file
ls -lah /u01/export_dir/una_ong_full_*.dmp

# Step 2: Create MD5 checksum for integrity verification
md5sum /u01/export_dir/una_ong_full_20260815.dmp > checksum.md5

# Step 3: Copy to USB drive
# Physically connect USB 3.0 external disk
mount /dev/sdX1 /mnt/usb
cp /u01/export_dir/una_ong_full_20260815.dmp /mnt/usb/
cp /u01/export_dir/una_ong_export_20260815.log /mnt/usb/
cp checksum.md5 /mnt/usb/
umount /mnt/usb

# Step 4: Transport USB to on-premises location
# (Physical security: encrypted container or armed courier recommended)

# Step 5: On on-premises database server
mount /dev/sdX1 /mnt/usb
cp /mnt/usb/una_ong_full_20260815.dmp /tmp/
cp /mnt/usb/checksum.md5 /tmp/

# Verify integrity:
md5sum -c /tmp/checksum.md5
# Output: /tmp/una_ong_full_20260815.dmp: OK
```

#### Option B: Secure Network Transfer (if DB servers connected to same network during cutover)

```bash
# On OCI instance:
scp -P 22 -i ~/.ssh/id_rsa /u01/export_dir/una_ong_full_20260815.dmp \
  oracle@10.x.x.50:/tmp/

# Monitor transfer (for 10 GB on gigabit LAN):
# Estimated time: 15–20 minutes (accounting for TCP overhead)

# Verify on destination:
md5sum /tmp/una_ong_full_20260815.dmp
```

---

### 6.2 Prepare On-Premises Database for Import

```bash
# On database server (una-db-01), as oracle user:
sqlplus / as sysdba

-- Drop any pre-created tablespaces (from fresh install):
SQL> DROP TABLESPACE UNASYS INCLUDING CONTENTS AND DATAFILES;

-- Create import directory:
SQL> CREATE OR REPLACE DIRECTORY import_dir AS '/tmp';
Directory created.

-- Verify:
SQL> SELECT * FROM ALL_DIRECTORIES WHERE DIRECTORY_NAME = 'IMPORT_DIR';

SQL> EXIT
```

---

### 6.3 Import Data Pump Export

```bash
# As oracle user on database server:

# Step 1: Pre-import validation
impdp system/password DIRECTORY=import_dir DUMPFILE=una_ong_full_20260815.dmp \
  SQLFILE=una_ong_precheck_20260815.sql LOGFILE=una_ong_import_precheck.log

# This generates SQL script without executing; review:
cat /tmp/una_ong_precheck_20260815.sql | head -100
# Look for: CREATE TABLE, CREATE INDEX, CREATE PROCEDURE
# Verify: no hard-coded connection strings to OCI

# Step 2: Execute import (main operation)
impdp system/password FULL=Y DIRECTORY=import_dir DUMPFILE=una_ong_full_20260815.dmp \
  LOGFILE=una_ong_import_20260815.log

# Estimated duration:
# - 5 GB dump: 2–3 hours
# - 10 GB dump: 4–6 hours
# - 15 GB dump: 6–8 hours
# (Depends on index rebuild, constraint validation, and disk I/O speed)

# Monitor progress:
tail -f /tmp/una_ong_import_20260815.log | grep -i "completed\|error\|processed"

# Step 3: Verify import completion
tail -20 /tmp/una_ong_import_20260815.log
# Expected final line: "Import terminated successfully without warnings"
```

### 6.4 Post-Import Database Verification

```sql
-- As SYSDBA, logged into on-premises instance:
sqlplus / as sysdba

-- Step 1: Verify schema integrity
SQL> SELECT OWNER, COUNT(*) FROM DBA_TABLES WHERE OWNER = 'UNASYS' GROUP BY OWNER;
-- Expected: UNASYS | ~150 (adjust per actual count)

SQL> SELECT COUNT(*) FROM UNASYS.ACCOUNTS;
-- Expected: Several thousand rows (Chart of Accounts)

SQL> SELECT COUNT(*) FROM UNASYS.INVOICES;
-- Expected: Historical invoices (e.g., 50,000+)

SQL> SELECT COUNT(*) FROM UNASYS.GRANT_PROJECTS;
-- Expected: Active/closed project records

-- Step 2: Check for invalid objects (from migration):
SQL> SELECT COUNT(*) FROM DBA_INVALID_OBJECTS WHERE OWNER = 'UNASYS';
-- Expected: 0 (if >0, recompile via: ALTER PACKAGE body_name COMPILE BODY;)

-- Step 3: Verify system parameters (no OCI-specific settings):
SQL> SELECT NAME, VALUE FROM V$PARAMETER 
       WHERE NAME IN ('db_name', 'control_files', 'archive_dest_1', 'log_archive_dest_1');
-- Confirm: db_name = UNASYS, no archive destinations (Free Tier limitation)

-- Step 4: Check tablespace status:
SQL> SELECT TABLESPACE_NAME, STATUS, CONTENTS FROM DBA_TABLESPACES ORDER BY 1;
-- Expected: All status = ONLINE

-- Step 5: Verify user/role permissions:
SQL> SELECT USERNAME, ACCOUNT_STATUS FROM DBA_USERS WHERE ACCOUNT_STATUS = 'OPEN' AND USERNAME IN ('UNASYS', 'SYSTEM');
-- Expected: Both accounts OPEN

-- Step 6: Test stored procedures (critical for invoice generation):
SQL> SELECT COUNT(*) FROM DBA_PROCEDURES WHERE OWNER = 'UNASYS';
-- Expected: ~80–120 procedures/functions

-- Execute test procedure:
SQL> SET SERVEROUTPUT ON
SQL> EXEC UNASYS.PKG_REPORTS.GEN_REPORT_TEMPLATE('IPC21_MONTHLY', '202608');
-- Expected: "Procedure completed successfully" (no ORA- errors)

-- Step 7: Run application-level consistency check:
SQL> BEGIN
       UNASYS.PKG_AUDIT.VALIDATE_DATABASE_INTEGRITY();
       COMMIT;
     END;
     /
-- Expected: No exceptions; transaction log shows validation complete

SQL> EXIT
```

---

## 7. Post-Migration Configuration

### 7.1 Application Server Initialization

```powershell
# On una-app-01, as Administrator:

# Step 1: Update connection profile in UNA.md
# File: C:\Program Files\UNASYS\ONG\config\una.ini

# Edit with Notepad++:
[Database]
Provider=ODP.NET
Host=10.x.x.50
Port=1521
ServiceName=UNASYS
Username=SYSTEM
Password=[encrypted via UNA.md wizard]

[Application]
DefaultUser=ADMIN
Environment=PRODUCTION
LogLevel=INFO

# Step 2: Clear application cache:
Remove-Item -Path "C:\ProgramData\UNASYS\ONG\Cache\*" -Recurse

# Step 3: Initialize application database tables (if empty):
# (Usually not needed after import, but safety check)
Start-Service -Name "UNA.ONG.AppServer"
Start-Sleep -Seconds 10

# Step 4: Launch client and verify:
# Menu: Tools → Database → Integrity Check
# Expected output: "All tables OK (150 tables, 42 indexes, 120 procedures)"

# Step 5: Configure backup destination:
# Menu: Tools → Options → Backup
# Local path: E:\UNASYS_BACKUPS (or network share \\backup-share\una)
# Frequency: Daily, 22:00 (after business hours)
# Retention: 30 days
```

### 7.2 Create Application Users

```sql
-- On database server, as SYSDBA:
sqlplus / as sysdba

-- Step 1: Create application admin user:
SQL> CREATE USER una_admin IDENTIFIED BY "[strong_password_23chars_min]"
       DEFAULT TABLESPACE USERS QUOTA UNLIMITED ON USERS;

SQL> GRANT CREATE SESSION, CREATE TABLE, CREATE PROCEDURE TO una_admin;

-- Step 2: Create read-only user (for reports/audit):
SQL> CREATE USER una_readonly IDENTIFIED BY "[password]"
       DEFAULT TABLESPACE USERS;

SQL> GRANT SELECT ON UNASYS.ACCOUNTS TO una_readonly;
SQL> GRANT SELECT ON UNASYS.INVOICES TO una_readonly;
SQL> GRANT SELECT ON UNASYS.GRANT_PROJECTS TO una_readonly;
SQL> GRANT EXECUTE ON UNASYS.PKG_REPORTS TO una_readonly;

-- Step 3: Create dedicated payroll user:
SQL> CREATE USER una_payroll IDENTIFIED BY "[password]"
       DEFAULT TABLESPACE USERS;

SQL> GRANT SELECT, INSERT, UPDATE ON UNASYS.TIMESHEETS TO una_payroll;
SQL> GRANT SELECT, INSERT, UPDATE ON UNASYS.SALARY_CALC TO una_payroll;
SQL> GRANT EXECUTE ON UNASYS.PKG_PAYROLL TO una_payroll;

-- Step 4: Verify users:
SQL> SELECT USERNAME, ACCOUNT_STATUS FROM DBA_USERS WHERE USERNAME LIKE 'UNA_%';

SQL> EXIT
```

### 7.3 Configure Backup Strategy

```bash
# On database server, as root:

# Step 1: Create backup directory:
mkdir -p /backup/oracle_rman
chown -R oracle:oinstall /backup/oracle_rman
chmod 750 /backup/oracle_rman

# Step 2: Create daily backup script:
cat > /home/oracle/backup_una.sh << 'EOF'
#!/bin/bash
# Daily RMAN backup for UNASYS database
# Run via cron: 23 * * * *

ORACLE_HOME=/opt/oracle/product/23c
ORACLE_SID=UNASYS
export ORACLE_HOME ORACLE_SID

$ORACLE_HOME/bin/rman TARGET / << EOFBACK
CONFIGURE DEFAULT DEVICE TYPE TO DISK;
CONFIGURE CONTROLFILE AUTOBACKUP ON;
CONFIGURE BACKUP OPTIMIZATION ON;
RUN {
  BACKUP DATABASE PLUS ARCHIVELOG;
  DELETE NOPROMPT OBSOLETE RETENTION DAYS 30;
  REPORT NEED BACKUP;
}
EXIT;
EOFBACK

# Copy backup to external location (if >100 GB, use disk staging):
find /backup/oracle_rman -name "*.bkp" -mtime -1 -exec \
  cp {} \\backup-server\una_backups \; 2>/dev/null

# Log rotation:
echo "Backup completed on $(date)" >> /var/log/oracle_backup.log
EOF

chmod +x /home/oracle/backup_una.sh

# Step 3: Schedule via cron (as oracle user):
# crontab -e
# 23 22 * * * /home/oracle/backup_una.sh > /tmp/backup_una.log 2>&1

# Step 4: Test backup:
/home/oracle/backup_una.sh
tail -50 /tmp/backup_una.log | grep -i "completed\|error"
```

### 7.4 Configure Monitoring & Alerts

```bash
# Option A: Oracle Enterprise Manager (if licensed)
# -- Not available on Free Tier; use alternatives below

# Option B: Custom monitoring script (minimal):
cat > /home/oracle/check_database.sh << 'EOF'
#!/bin/bash
# Database health check; email alert if issues found

ORACLE_HOME=/opt/oracle/product/23c
ORACLE_SID=UNASYS
export ORACLE_HOME ORACLE_SID

# Check 1: Instance running
$ORACLE_HOME/bin/sqlplus -S / as sysdba << EOFCHECK1
SET HEADING OFF FEEDBACK OFF PAGESIZE 0 LINESIZE 32767
SELECT OPEN_CURSORS FROM V\$PARAMETER WHERE NAME = 'open_cursors';
EXIT;
EOFCHECK1

if [ $? -ne 0 ]; then
  echo "ALERT: Database instance UNASYS not running" | mail -s "Database Alert" admin@gov.md
  exit 1
fi

# Check 2: Tablespace usage
$ORACLE_HOME/bin/sqlplus -S / as sysdba << EOFCHECK2
SET HEADING OFF FEEDBACK OFF PAGESIZE 0 LINESIZE 32767
SELECT ROUND(SUM(BYTES) / 1024 / 1024 / 1024, 2) AS SIZE_GB FROM DBA_DATA_FILES;
EXIT;
EOFCHECK2

# Check 3: Invalid objects
INVALID=$($ORACLE_HOME/bin/sqlplus -S / as sysdba << EOFCHECK3
SET HEADING OFF FEEDBACK OFF PAGESIZE 0 LINESIZE 32767
SELECT COUNT(*) FROM DBA_INVALID_OBJECTS WHERE OWNER = 'UNASYS';
EXIT;
EOFCHECK3
)

if [ "$INVALID" -gt 0 ]; then
  echo "ALERT: $INVALID invalid objects in UNASYS schema" | mail -s "Database Alert" admin@gov.md
fi

echo "Health check completed at $(date)" >> /var/log/db_health.log
EOF

chmod +x /home/oracle/check_database.sh

# Schedule (crontab -e, as oracle user):
# 06 * * * * /home/oracle/check_database.sh
```

---

## 8. Post-Migration Validation Checklist

**Timeline: Day of cutover + 1 week**

### 8.1 Immediate Post-Cutover (Day 0, within 2 hours)

- [ ] **Database Connectivity**
  - [ ] sqlplus system@UNASYS from app server returns `SQL>` prompt
  - [ ] SELECT COUNT(*) FROM UNASYS.ACCOUNTS returns >1000 rows
  - [ ] No ORA- errors in /tmp/*.log

- [ ] **Application Launch**
  - [ ] UNA.md client starts without connection errors
  - [ ] Main menu visible (File, Edit, View, Tools, Help)
  - [ ] Chart of Accounts tree populated
  - [ ] Current period shows in status bar

- [ ] **User Authentication**
  - [ ] Login with SYSTEM account succeeds
  - [ ] Login with una_admin account succeeds
  - [ ] Login with invalid credentials properly rejected

- [ ] **Basic Data Retrieval**
  - [ ] View → Accounts → Open List: Shows all accounts (should match OCI count)
  - [ ] View → Invoices → Open List: Shows invoices from import
  - [ ] View → Projects → Open List: Shows grant projects from import
  - [ ] No data truncation or corruption visible

- [ ] **Report Generation**
  - [ ] Tools → Reports → Chart of Accounts (PDF export)
  - [ ] Tools → Reports → Trial Balance (current month)
  - [ ] Tools → Reports → Vendor Report (by project)
  - [ ] All exports complete without errors

- [ ] **Network Security**
  - [ ] nmap from external machine shows port 1521 blocked
  - [ ] SSH to DB server restricted to admin IP only
  - [ ] RDP to app server restricted to admin IP only
  - [ ] No unexpected outbound traffic on WAN link

### 8.2 Functionality Validation (Days 1–3)

- [ ] **Transaction Processing**
  - [ ] Create new invoice (test data)
  - [ ] Allocate to grant project
  - [ ] Verify cost appears in project ledger
  - [ ] Delete test invoice and confirm reversal

- [ ] **Payroll Module**
  - [ ] View → Timesheets → current month
  - [ ] Create timesheet entry for test employee
  - [ ] Run payroll calculation (Tools → Payroll → Calculate)
  - [ ] Verify salary amount, tax deduction, project allocation
  - [ ] Generate salary slip (PDF)

- [ ] **Multi-Currency Support**
  - [ ] Create invoice in EUR, allocate to USD-funded project
  - [ ] Verify exchange rate applied from last OCI import
  - [ ] Generate multi-currency report

- [ ] **Reporting Compliance**
  - [ ] Tools → Reports → IPC21 (monthly unified report)
  - [ ] Generate XML export for SFS submission (if applicable)
  - [ ] Verify report period = current month from on-premises instance
  - [ ] Cross-check row counts vs. OCI export log

- [ ] **Audit Trail**
  - [ ] Tools → Audit → View Log for last 24 hours
  - [ ] Verify entries include user, timestamp, table, operation
  - [ ] Export audit log to CSV

### 8.3 Performance & Stability (Days 4–7)

- [ ] **Response Time**
  - [ ] List 50,000 invoices: <3 seconds (from on-premises DB)
  - [ ] Generate IPC21 report: <30 seconds
  - [ ] Export to Excel: <60 seconds
  - [ ] No timeout errors in logs

- [ ] **Concurrent Users**
  - [ ] Login with 3 simultaneous users
  - [ ] Each user opens different modules (Accounts, Payroll, Projects)
  - [ ] No "resource temporarily unavailable" errors
  - [ ] Database connection pool shows 3 active sessions

- [ ] **Backup Functionality**
  - [ ] Tools → Options → Backup → Run Now
  - [ ] Backup file created in E:\UNASYS_BACKUPS\*
  - [ ] Backup file size reasonable (not 0 bytes, not >50 GB)
  - [ ] Verify backup destination accessible from both servers

- [ ] **Database Logs**
  - [ ] Check alert log for errors:
    ```bash
    tail -100 $ORACLE_HOME/diag/rdbms/unasys/UNASYS/trace/alert_UNASYS.log
    ```
  - [ ] Expected: No ORA- errors, no "critical" messages
  - [ ] Expected: Listener startup, database open, archive mode disabled

- [ ] **System Resource Usage**
  - [ ] DB server CPU: <60% average (during business hours)
  - [ ] DB server RAM: <80% average
  - [ ] DB server Disk I/O: <50% average
  - [ ] App server CPU: <50% average
  - [ ] App server RAM: <70% average

- [ ] **Network Latency**
  - [ ] ping una-db-01 from una-app-01: <1 ms
  - [ ] tnsping UNASYS: <50 ms
  - [ ] Database query (SELECT 1): <100 ms round-trip

### 8.4 Disaster Recovery Readiness

- [ ] **Restore Test**
  - [ ] Restore from backup to test server (or alternate disk)
  - [ ] Verify data integrity after restore
  - [ ] Estimate recovery time objective (RTO): <30 min
  - [ ] Estimate recovery point objective (RPO): <24 hours

- [ ] **Failover Procedure Documented**
  - [ ] If DB server fails: App reconnects to hot standby (if available) or manual restart procedure documented
  - [ ] If App server fails: Manual restart on alternate Windows machine documented
  - [ ] Step-by-step recovery guide printed and stored offline

---

## 9. Network & Security Configuration

### 9.1 Firewall Rules (iptables on DB Server)

```bash
# As root on una-db-01:

# Step 1: Set default policies (drop all unless explicitly allowed)
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# Step 2: Allow loopback (required for Oracle):
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# Step 3: Allow SSH from admin IPs only:
iptables -A INPUT -p tcp -s 10.x.x.100 --dport 22 -j ACCEPT
iptables -A INPUT -p tcp -s 10.x.x.101 --dport 22 -j ACCEPT
# (Add other admin IPs as needed)

# Step 4: Allow Oracle listener (1521) from app server only:
iptables -A INPUT -p tcp -s 10.x.x.51 --dport 1521 -j ACCEPT

# Step 5: Allow DNS (if needed for external NTP):
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A INPUT -p udp --sport 53 -j ACCEPT

# Step 6: Allow NTP (for time synchronization):
iptables -A OUTPUT -p udp --dport 123 -j ACCEPT
iptables -A INPUT -p udp --sport 123 -j ACCEPT

# Step 7: Drop everything else (should already be dropped by policy):
iptables -A INPUT -j LOG --log-prefix "IPTABLES_DROP: "
iptables -A INPUT -j DROP

# Step 8: Save rules permanently:
iptables-save > /etc/sysconfig/iptables

# Verify:
iptables -L -n -v
# Output: Should show INPUT chain with SSH rule, Oracle rule, nothing else
```

### 9.2 Windows Firewall Rules (App Server)

```powershell
# As Administrator on una-app-01:

# Step 1: Enable Windows Firewall:
Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled True

# Step 2: Allow outbound to DB server (1521):
New-NetFirewallRule -DisplayName "Allow Oracle DB Connection" `
  -Direction Outbound -Action Allow -Protocol TCP `
  -RemoteAddress 10.x.x.50 -RemotePort 1521

# Step 3: Allow inbound RDP from admin IPs only:
New-NetFirewallRule -DisplayName "Allow RDP from Admin" `
  -Direction Inbound -Action Allow -Protocol TCP `
  -LocalPort 3389 -RemoteAddress 10.x.x.100

# Step 4: Allow inbound WinRM (for remote PowerShell scripts):
Enable-PSRemoting -Force
New-NetFirewallRule -DisplayName "Allow WinRM" `
  -Direction Inbound -Action Allow -Protocol TCP `
  -LocalPort 5985 -RemoteAddress 10.x.x.50

# Step 5: Verify rules:
Get-NetFirewallRule -Direction Inbound -Enabled True | Select-Object DisplayName, Action, RemotePort

# Step 6: Enable logging for dropped packets (for troubleshooting):
Set-NetFirewallProfile -Profile Domain,Public,Private -LogFileName "%systemroot%\system32\LogFiles\Firewall\pfirewall.log" -LogMaxSizeKilobytes 32767 -LogAllowed True -LogBlocked True
```

### 9.3 Database User Security

```sql
-- As SYSDBA on database server:

-- Step 1: Set password policy for all users:
ALTER SESSION SET "_ORACLE_SCRIPT"=TRUE;

CREATE PROFILE UNA_PWD_POLICY LIMIT
  FAILED_LOGIN_ATTEMPTS 5
  PASSWORD_LIFE_TIME 90
  PASSWORD_GRACE_TIME 14
  PASSWORD_REUSE_TIME 365
  PASSWORD_REUSE_MAX 5
  PASSWORD_LOCK_TIME 1
  PASSWORD_VERIFY_FUNCTION ORA12C_STRONG_VERIFY_FUNCTION;

-- Step 2: Assign profile to application users:
ALTER USER SYSTEM PROFILE UNA_PWD_POLICY;
ALTER USER una_admin PROFILE UNA_PWD_POLICY;
ALTER USER una_payroll PROFILE UNA_PWD_POLICY;

-- Step 3: Audit database access:
AUDIT CONNECT BY SYSTEM BY una_admin BY una_payroll;
AUDIT SELECT TABLE BY UNASYS;
AUDIT INSERT TABLE BY UNASYS;
AUDIT DELETE TABLE BY UNASYS;

-- Step 4: Verify audit trail:
SELECT AUDIT_TYPE, USERNAME, TIMESTAMP, STATEMENT FROM DBA_AUDIT_TRAIL 
  WHERE CREATED >= TRUNC(SYSDATE) ORDER BY TIMESTAMP DESC;

-- Step 5: Restrict remote access to database:
ALTER SYSTEM SET REMOTE_LOGIN_PASSWORDFILE = NONE SCOPE = BOTH;

-- Step 6: Disable unnecessary Oracle accounts:
ALTER USER DBSNMP ACCOUNT LOCK PASSWORD EXPIRE;
ALTER USER OUTLN ACCOUNT LOCK PASSWORD EXPIRE;

-- Step 7: Grant minimal privileges to application users:
-- (Already done in Section 7.2, but reinforce here)
REVOKE DBA FROM una_admin;  -- Remove if granted accidentally
REVOKE CREATE ANY OBJECT FROM una_admin;
```

---

## 10. Troubleshooting & Common Issues

| Issue | Symptom | Diagnosis | Resolution |
|-------|---------|-----------|------------|
| **Database won't start** | ORA-00821: init.ora parameter not found | Check $ORACLE_HOME/dbs/init.ora exists | Restore initUNASYS.ora from backup or recreate via dbca |
| **Listener not responding** | ORA-12505: TNS:listener does not currently know of SID | Check listener.ora SERVICE_NAME = UNASYS | Edit listener.ora, lsnrctl stop, lsnrctl start |
| **Import hangs at 50%** | No progress for >30 min | Check disk space: df -h / (need 50% free) | Stop import (Ctrl+C), free space, restart import with RESUMABLE |
| **App can't connect to DB** | "ORA-12514: TNS:listener could not resolve the connect identifier" | Check tnsnames.ora on app server | Verify hostname/port correct, run tnsping UNASYS from app server |
| **Payroll calculation fails** | "ORA-00904: Invalid column name TIMESHEET_ID" | Schema mismatch between OCI export and on-premises | Re-run import with SKIP=STATISTICS to rebuild indexes |
| **Backup grows to 200 GB** | Disk usage explodes after first backup | Archive mode enabled (should be disabled on Free Tier) | Confirm: SELECT ARCHIVELOG DESTINATION FROM V$PARAMETER; should be empty |
| **Users locked after import** | "ORA-28000: Your account has been locked" | Default password complexity policy | Unlock: ALTER USER una_admin ACCOUNT UNLOCK; SET PASSWORD |
| **Report generation timeout** | "Timeout waiting for database query" after 60 sec | Large result set (>1M rows) not using pagination | Recompile UNASYS.PKG_REPORTS with pagination cursors |
| **Network latency high (>1 sec)** | Database queries slow despite small result set | Network congestion between servers or firewall rule misconfiguration | Run iperf3 between servers to confirm LAN speed; check firewall logs |
| **Data appears corrupted after import** | Decimal amounts show as integers (e.g., 1.50 EUR → 150) | Oracle 21c→23c character set mismatch or column type mismatch | Run import log analysis; verify UNASYS.INVOICES.AMOUNT_EUR datatype |

---

## 11. Support & Maintenance Model for On-Premises

### 11.1 Licensing & Cost

| Item | OCI PaaS (Cloud) | On-Premises (Free Tier) |
|------|---|---|
| Oracle Database License | Included in managed service | Free (Oracle 23c Free Tier) |
| UNA.md Software License | €50/month (SaaS) or variable (PaaS) | Perpetual license (~€2,500 one-time) |
| Hardware | Shared infrastructure | Customer-owned (see Section 2) |
| Backup & Disaster Recovery | OCI managed backups (included) | Customer-managed via RMAN |
| Security patches | OCI applies automatically | Customer applies via yum/Windows Update |
| Support | UNA.md team manages all | Shifts to advisory model |

### 11.2 Vendor Support Model Change

**Before (OCI PaaS):**
- UNA.md owns infrastructure; vendor manages patching, backups, HA failover
- SLA: 99.5% uptime, 1-hour response for critical issues
- Cost: Transparent per-instance pricing

**After (On-Premises):**
- Customer owns infrastructure; UNA.md provides guidance and emergency support
- SLA: 8x5 business hours (no weekend/holiday), best-effort response
- Support includes: remote screen-sharing, troubleshooting scripts, documentation updates
- Cost: Typically €300–500/year for advisory support package (optional but recommended)

### 11.3 Maintenance Schedule

```
Monthly (1st Tuesday):
  - OS security patches (yum update, Windows Update)
  - Database alert log review (grep ORA- /tmp/alert*.log)
  - Backup verification (ls -lah /backup/oracle_rman)

Quarterly (Jan, Apr, Jul, Oct):
  - Oracle Free Tier upgrade check (www.oracle.com/database/free)
  - UNA.md application update (if available)
  - Disaster recovery drill (restore backup to test server)

Annually:
  - Hardware health check (disk SMART status, RAM test)
  - Full audit trail review (DBA_AUDIT_TRAIL)
  - Capacity planning (growth rate analysis)
  - License compliance audit
```

---

## 12. Migration Timeline & Rollback

### 12.1 Cutover Schedule

```
Day -3 (Wed):
  ✓ Freeze data entry (Section 4.1)
  ✓ Export from OCI (Section 4.1)
  ✓ Generate backup and checksums

Day -1 (Thu):
  ✓ Physical transfer of dump file to on-premises (Section 6.1)
  ✓ Test connectivity between servers (ping, tnsping)
  ✓ Final inventory: user count, project count, invoice count

Day 0 (Fri) - Main Cutover:
  Time  Planned Activity
  ----  ----------------
  14:00 Announce maintenance window to all NGO staff
  14:10 Stop UNA.md application on OCI
  14:15 Take final backup of OCI instance (RMAN BACKUP)
  14:30 Begin import on on-premises server (Section 6.3)
  14:35 Monitor import progress (tail -f logfile)
  15:30 [Estimated import completion for 10 GB dump]
  15:35 Run post-import validation SQL (Section 6.4)
  15:45 Test app-to-DB connectivity from Windows server
  16:00 Launch UNA.md client and verify data
  16:15 Create test transaction; verify it appears in database
  16:30 Announce cutover complete
  16:45 Resume normal operations (staff logs in)
  22:00 Audit log review (check for errors during cutover)

Day +1 (Sat):
  10:00 Review error logs
  10:30 Run validation checklist (Section 8.1)
  12:00 Prepare incident report (if any issues)

Day +3 to +7:
  - Run full validation checklist (Section 8.2 & 8.3)
  - Monitor database performance
  - Verify backups completed
```

### 12.2 Rollback Procedure (If Needed)

**Trigger:** Cutover fails; data corruption detected; unrecoverable error within 12 hours

```bash
# Step 1: Stop all UNA.md processes on on-premises
systemctl stop "UNA.ONG*"
systemctl stop oracledb

# Step 2: Restore OCI instance from pre-cutover backup
# (Performed by OCI team via recovery console)
# Point-in-time restore to: 2026-08-15 14:00 UTC

# Step 3: Start OCI instance and run verification
# Contact OCI support; ETA: 30–60 minutes for restore

# Step 4: Rebuild on-premises database to pre-import state
sqlplus / as sysdba << EOFROLLBACK
  SHUTDOWN ABORT;
  STARTUP MOUNT;
  RECOVER DATABASE;  -- If archivelog enabled; otherwise:
  SHUTDOWN IMMEDIATE;
  -- Restore from filesystem backup or recreate
  STARTUP;
EOFROLLBACK

# Step 5: Point UNA.md back to OCI
# Update tnsnames.ora on Windows server to OCI hostname
# Restart UNA.ONG.AppServer service

# Step 6: Notify staff; resume operations
# "Temporary rollback due to [issue]. OCI system restored; normal operations resumed."

# Rollback RTO: 1–2 hours (assuming OCI backup available)
```

---

## 13. Known Limitations: On-Premises vs. Cloud

| Feature | OCI PaaS (Cloud) | On-Premises (Free Tier) |
|---------|---|---|
| **Automatic backups** | Yes (daily, retained 7 days) | No; manual RMAN required |
| **Automatic patching** | Yes (zero-downtime) | No; manual OS/DB patches |
| **Database replication / HA** | Available (Data Guard, RAC) | Not available (single-instance only) |
| **Encryption at rest** | Yes (TDE) | Not available on Free Tier |
| **Automatic failover** | Yes (99.9% SLA) | No; manual restore from backup |
| **Scaling CPU/RAM** | Instant (resize instance) | Requires server hardware upgrade |
| **Managed compliance audits** | Yes (OCI SOC2, ISO 27001) | Customer responsibility |
| **Disaster recovery region** | Yes (backup to 2nd region) | Requires 2nd on-premises site |

**Mitigation Strategies:**
1. **Backups:** Implement off-site backup replication (copy to external USB/NAS weekly)
2. **Patching:** Schedule monthly maintenance windows; test patches on non-prod server first
3. **Uptime:** Implement monitoring + alert system (Section 7.4); keep spare hardware on-hand
4. **Encryption:** Use OS-level disk encryption (dm-crypt on Linux, BitLocker on Windows) as alternative

---

## 14. FAQ & Contact

**Q: Can I move back to OCI PaaS later?**  
A: Yes. Export from on-premises using Data Pump, import to OCI. Cost for initial migration: ~€500 (similar to forward migration). Data integrity guaranteed.

**Q: What if the on-premises database fails?**  
A: Recovery time is 1–4 hours (restore from latest backup). Recommend maintaining: (a) daily backups, (b) off-site copy, (c) documented recovery procedure.

**Q: Can I add more users/projects without upgrade?**  
A: On-premises infrastructure is fixed; no limit on users imposed by Oracle Free Tier (unlike cloud instance scaling). Add users via SQL; scale hardware if needed.

**Q: How do I get support if something breaks?**  
A: Contact UNA.md support team during business hours (8 AM–5 PM CET, Mon–Fri). Provide: error logs, reproduction steps, hardware specs. Response time: 4–8 hours. For critical issues: phone escalation available.

**Q: Will on-premises be cheaper than cloud long-term?**  
A: Break-even occurs after ~3 years (initial hardware ~€3,000 + annual maintenance €500 vs. cloud at €600–1,000/year). On-premises suited for long-term stability; cloud suited for flexibility.

**Q: Is Oracle Free Tier appropriate for government use?**  
A: Yes. Oracle 23c Free Tier is production-ready, patched regularly, and used by thousands of small businesses globally. No functional limitations for NGO/government accounting workloads (single-instance, no multi-site replication).

---

## Appendix A: Checklist (Printable)

```
PRE-MIGRATION (Week -1):
  [ ] Database server OS installed and patched
  [ ] Application server OS installed and patched
  [ ] Network connectivity verified (ping, DNS)
  [ ] Export from OCI completed and verified
  [ ] USB drive transfer scheduled
  [ ] Support contact information confirmed
  [ ] Staff notified of maintenance window

INSTALLATION DAY (Day 0):
  [ ] Oracle 23c installed on Linux server
  [ ] Database instance UNASYS created and running
  [ ] Listener configured and accepting connections on 0.0.0.0:1521
  [ ] Oracle Instant Client installed on Windows server
  [ ] TNSNAMES.ORA configured on Windows server
  [ ] Database connectivity test successful (sqlplus system@UNASYS)

IMPORT DAY (Day 0):
  [ ] Dump file copied to /tmp on database server
  [ ] MD5 checksum verified
  [ ] Pre-import checks passed (review DDL, tablespace count)
  [ ] Import started (impdp)
  [ ] Import completion verified (no errors in log)
  [ ] Post-import validation passed (table counts, procedures)

POST-MIGRATION (Day +1 to +7):
  [ ] Application connectivity verified
  [ ] Test data created and saved successfully
  [ ] Payroll module tested
  [ ] IPC21 report generated
  [ ] Backup created and tested
  [ ] Performance baseline measured (query response times)
  [ ] All checks in Section 8 completed
  [ ] Sign-off from IT director and finance director
```

---

## Appendix B: Command Reference

```bash
# Oracle server commands
sqlplus / as sysdba              # Connect as DBA
STARTUP;                         # Start database
SHUTDOWN IMMEDIATE;              # Stop database gracefully
SHUTDOWN ABORT;                  # Emergency stop
ARCHIVE LOG LIST;                # Show archivelog status
SELECT NAME FROM V$DATABASE;     # Show database name
SELECT OPEN_CURSORS FROM V$PARAMETER WHERE NAME='open_cursors';  # Check cursor limit
RMAN> BACKUP DATABASE;           # Backup all data

# Network commands
tnsping UNASYS                   # Test database connectivity
sqlplus system@UNASYS            # Connect remotely via tnsnames
lsnrctl status                   # Show listener status
lsnrctl stop / start             # Control listener

# Import/Export
expdp system FULL=Y              # Export full database
impdp system FULL=Y DUMPFILE=x.dmp  # Import full database
```

---

**Document Version:** 1.0  
**Last Updated:** August 15, 2026  
**For Questions:** Support via UNA.md vendor portal or ptuhari@gmail.com  
**Confidentiality:** For Moldovan Cybersecurity Agency (Agenția pentru Securitatea Cibernetică) use only.

