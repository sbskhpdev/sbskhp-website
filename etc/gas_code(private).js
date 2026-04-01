/**
 * 시트가 열릴 때 실행되는 함수
 */
function onOpen() {
  // 비공개 시트에서는 캘린더 동기화 메뉴를 사용하지 않습니다.
}

/**
 * 웹사이트에서 데이터를 호출할 때 실행되는 함수 (API)
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const type = (e.parameter.type || 'Education').trim();
    
    // [수정] 신청 내역 조회 로직 (변경된 헤더 대응)
    if (type === 'CheckApplication') {
      const name = (e.parameter.name || "").trim();
      const email = (e.parameter.email || "").trim();
      const sheet = getSheetCaseInsensitive(ss, 'Applications');
      if (!sheet) return createJsonResponse({ error: 'Applications sheet not found' });
      
      const data = sheet.getDataRange().getDisplayValues();
      if (data.length <= 1) return createJsonResponse([]);
      
      const headers = data[0].map(h => h.toString().trim());
      const rows = data.slice(1);
      
      // 이름(Index 1)과 이메일(Index 7)로 검색
      const found = rows.filter(row => 
        row[1].toString().trim() === name && 
        row[7].toString().trim() === email
      ).map(row => {
        const obj = {};
        headers.forEach((header, i) => {
          if (header) obj[header] = row[i];
        });
        return obj;
      });
      
      return createJsonResponse(found);
    }
    
    let sheet = getSheetCaseInsensitive(ss, type);
    
    if (!sheet) return createJsonResponse({ error: `Sheet named '${type}' not found.` });
    
    const range = sheet.getDataRange();
    if (range.isBlank()) return createJsonResponse([]);
    
    const data = range.getDisplayValues();
    if (data.length === 0) return createJsonResponse([]);
    
    const headers = data[0].map(h => h.toString().trim());
    const rows = data.slice(1);
    
    const result = rows.map(row => {
      const obj = {};
      headers.forEach((header, i) => {
        if (header) obj[header] = row[i];
      });
      return obj;
    });
    
    return createJsonResponse(result);
  } catch (err) {
    return createJsonResponse({ error: err.toString() });
  }
}

/**
 * 시트 이름을 대소문자 및 공백 무시하고 찾습니다.
 */
function getSheetCaseInsensitive(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (sheet) return sheet;
  
  const allSheets = ss.getSheets();
  const searchName = name.toLowerCase().trim();
  return allSheets.find(s => s.getName().toLowerCase().trim() === searchName);
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 웹사이트에서 데이터를 제출할 때 실행되는 함수 (신청서 저장)
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    // 1. 최대 10초 대기 (동시 신청 방지)
    lock.waitLock(10000);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getSheetCaseInsensitive(ss, 'Applications');
    
    if (!sheet) return createJsonResponse({ error: "Applications sheet not found" });

    const data = JSON.parse(e.postData.contents);
    const type = (data.type || 'Apply').trim();

    // [취소 처리 로직]
    if (type === 'Cancel') {
      const allData = sheet.getDataRange().getValues();
      let foundRowIndex = -1;

      const searchName = (data.name || "").trim();
      const searchEmail = (data.email || "").trim();
      const searchCourse = (data.course || "").trim();

      // [수정] 가장 최근(마지막 행) 데이터부터 거꾸로 찾고, 상태가 '대기' 또는 '승인'인 경우만 취소 처리
      for (let i = allData.length - 1; i >= 1; i--) {
        const rowName = allData[i][1].toString().trim();
        const rowEmail = allData[i][7].toString().trim();
        const rowCourse = allData[i][3].toString().trim();
        const rowStatus = allData[i][6].toString().trim(); // 처리상태 (7번째 열)

        if (rowName === searchName && rowEmail === searchEmail && rowCourse === searchCourse) {
          if (rowStatus === '대기' || rowStatus === '승인') {
            foundRowIndex = i + 1; // 1-based index
            break;
          }
        }
      }

      if (foundRowIndex > 0) {
        sheet.getRange(foundRowIndex, 7).setValue('취소'); // 처리상태 (7번째 열)
        sheet.getRange(foundRowIndex, 14).setValue(data.cancelReason || '사용자 요청 취소'); // 취소사유 (14번째 열)
        
        // [추가] 취소 안내 이메일 발송
        sendApplicationEmail({
          name: searchName,
          email: searchEmail,
          course: searchCourse,
          status: '취소',
          reason: data.cancelReason
        });

        return createJsonResponse({ success: true, message: "취소가 성공적으로 처리되었습니다." });
      } else {
        return createJsonResponse({ success: false, error: "해당 신청 내역을 찾을 수 없습니다." });
      }
    }

    // [신청 처리 로직]
    const existingData = sheet.getDataRange().getValues();
    const applyName = (data.name || "").trim();
    const applyEmail = (data.email || "").trim();
    const applyFullCourse = (data.course || "").trim(); // 예: "AI영상제작 기초 (2회차)"
    const applyCourseBase = applyFullCourse.split(' (')[0].trim(); // 예: "AI영상제작 기초"

    // --- 1. 정원 및 현재 인원 체크 로직 추가 ---
    const eduSheet = getSheetCaseInsensitive(ss, 'Education');
    if (eduSheet) {
      const eduData = eduSheet.getDataRange().getValues();
      const eduHeaders = eduData[0];
      const titleIdx = eduHeaders.indexOf("Title");
      const roundIdx = eduHeaders.indexOf("회차");
      const limitIdx = eduHeaders.indexOf("정원");
      const statusIdx = eduHeaders.indexOf("Status");

      const roundMatch = applyFullCourse.match(/\((.*?)회차\)/);
      const applyRoundNum = roundMatch ? roundMatch[1] : "";

      const eduRowIndex = eduData.findIndex((r, idx) => {
        if (idx === 0) return false;
        const sTitle = String(r[titleIdx]).trim();
        let sRound = String(r[roundIdx]).trim().replace(/[^0-9]/g, '');
        return sTitle === applyCourseBase && sRound === applyRoundNum;
      });

      if (eduRowIndex !== -1) {
        const eduRowValue = eduData[eduRowIndex];
        const maxCapacity = parseInt(eduRowValue[limitIdx]) || 999;
        
        const currentCount = existingData.filter((row, idx) => {
          if (idx === 0) return false;
          const rCourse = String(row[3]).trim();
          const rStatus = String(row[6]).trim();
          return rCourse === applyFullCourse && rStatus !== '취소' && rStatus !== '반려';
        }).length;

        if (currentCount >= maxCapacity) {
          if (statusIdx !== -1) {
            eduSheet.getRange(eduRowIndex + 1, statusIdx + 1).setValue('모집마감');
          }
          return createJsonResponse({ 
            success: false, 
            error: `죄송합니다. 해당 과정은 모집 정원이 초과되어 마감되었습니다.` 
          });
        }
      }
    }
    // ----------------------------------------

    let duplicatedRound = "";
    const isDuplicate = existingData.some(row => {
      const rowName = row[1].toString().trim();
      const rowEmail = row[7].toString().trim();
      const rowFullCourse = row[3].toString().trim(); // 예: "AI영상제작 기초 (1회차)"
      const rowStatus = row[6].toString().trim(); // 처리상태 (Index 6)
      const rowCourseBase = rowFullCourse.split(' (')[0].trim();

      // 이름, 이메일, 과정명이 일치하고 상태가 '취소'나 '반려'가 아닌 경우만 중복으로 간주
      if (rowName === applyName && rowEmail === applyEmail && rowCourseBase === applyCourseBase) {
        if (rowStatus !== '취소' && rowStatus !== '반려') {
          // 이미 신청한 회차 정보를 추출 (메시지용)
          const match = rowFullCourse.match(/\((.*?)회차\)/);
          duplicatedRound = match ? match[1] : "";
          return true;
        }
      }
      return false;
    });

    if (isDuplicate) {
      const errorMsg = duplicatedRound 
        ? `해당 교육의 ${duplicatedRound}회차를 이미 신청하셨습니다. 동일 교육의 타 회차 신청은 불가합니다. 자세한 사항은 신청 확인 메뉴를 이용해 주세요.`
        : "이미 해당 교육 과정에 신청하신 내역이 있습니다. 신청 확인 메뉴를 이용해 주세요.";
      
      return createJsonResponse({ 
        success: false, 
        error: errorMsg
      });
    }

    // [수정] 헤더 이름을 기준으로 동적으로 데이터 배열 생성
    const headers = sheet.getDataRange().getValues()[0].map(h => h.toString().trim());
    const newRow = new Array(headers.length).fill("");

    // 각 필드 매핑 로직 (헤더 이름 기준)
    const setVal = (name, val) => {
      const idx = headers.indexOf(name);
      if (idx !== -1) newRow[idx] = val;
    };

    setVal("신청일시", new Date());
    setVal("이름", data.name);
    setVal("연락처", "'" + data.phone);
    setVal("신청과정", data.course);
    setVal("Start Date", data.startDate || '');
    setVal("End Date", data.endDate || '');
    setVal("처리상태", '대기');
    setVal("이메일", data.email);
    setVal("회사명", data.company || '');
    setVal("부서/직급", data.position);
    setVal("재직여부", data.employment);
    setVal("주민등록번호", '');
    setVal("비고", '');
    setVal("취소사유", '');
    // '처리변환일시'는 초기값이므로 건너뜀

    sheet.appendRow(newRow);
    
    // --- 2. 신청 후 정원이 꽉 찼는지 다시 확인하여 자동 모집마감 처리 ---
    const finalEduSheet = getSheetCaseInsensitive(ss, 'Education');
    if (finalEduSheet) {
      const finalEduData = finalEduSheet.getDataRange().getValues();
      const finalHeaders = finalEduData[0];
      const fTitleIdx = finalHeaders.indexOf("Title");
      const fRoundIdx = finalHeaders.indexOf("회차");
      const fLimitIdx = finalHeaders.indexOf("정원");
      const fStatusIdx = finalHeaders.indexOf("Status");

      const rMatch = applyFullCourse.match(/\((.*?)회차\)/);
      const rNum = rMatch ? rMatch[1] : "";

      const fRowIdx = finalEduData.findIndex((r, idx) => {
        if (idx === 0) return false;
        return String(r[fTitleIdx]).trim() === applyCourseBase && 
               String(r[fRoundIdx]).trim().replace(/[^0-9]/g, '') === rNum;
      });

      if (fRowIdx !== -1) {
        const fLimit = parseInt(finalEduData[fRowIdx][fLimitIdx]) || 999;
        const fCount = sheet.getDataRange().getValues().filter((row, idx) => {
          if (idx === 0) return false;
          return String(row[3]).trim() === applyFullCourse && 
                 (String(row[6]).trim() === '대기' || String(row[6]).trim() === '승인');
        }).length;

        if (fCount >= fLimit && fStatusIdx !== -1) {
          finalEduSheet.getRange(fRowIdx + 1, fStatusIdx + 1).setValue('모집마감');
        }
      }
    }
    // ------------------------------------------------------------

    // [추가] 신청 완료 안내 이메일 발송
    sendApplicationEmail({
      name: data.name,
      email: data.email,
      course: data.course,
      status: '대기'
    });

    return createJsonResponse({ success: true, message: "신청이 성공적으로 접수되었습니다." });
  } catch (err) {
    return createJsonResponse({ error: err.toString() });
  } finally {
    // 2. 잠금 해제 (반드시 실행)
    lock.releaseLock();
  }
}

/**
 * [추가] 이메일 발송 통합 함수
 */
function sendApplicationEmail(info) {
  const { name, email, course, status, reason, waitingNum } = info;
  
  // [추가] Education 시트에서 교육 정보 검색
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const eduSheet = ss.getSheetByName("Education");
  let eduInfo = { date: "추후 안내", location: "추후 안내" };

  if (eduSheet) {
    const eduData = eduSheet.getDataRange().getValues();
    const eduHeaders = eduData[0];
    const titleIdx = eduHeaders.indexOf("Title");
    const roundIdx = eduHeaders.indexOf("회차"); // Round -> 회차로 수정
    const startIdx = eduHeaders.indexOf("Start Date");
    const endIdx = eduHeaders.indexOf("End Date");
    const locIdx = eduHeaders.indexOf("Location");

    // 신청 데이터 예시: "AI영상제작 기초 (1회차)"
    // 시트 데이터 예시: Title="AI영상제작 기초", 회차="1"
    const row = eduData.find(r => {
      const sheetTitle = String(r[titleIdx]).trim();
      let sheetRound = String(r[roundIdx]).trim();
      
      // 혹시 시트의 "회차" 칸에 이미 "1회차"라고 적혀있을 경우를 대비해 숫자만 추출 시도
      const roundNumber = sheetRound.replace(/[^0-9]/g, ''); 
      const combinedTitle = `${sheetTitle} (${roundNumber || sheetRound}회차)`;
      
      return combinedTitle === course;
    });

    if (row) {
      const start = row[startIdx];
      const end = row[endIdx];
      const loc = row[locIdx];
      
      const formatDate = (d) => (d instanceof Date) ? Utilities.formatDate(d, "GMT+9", "yyyy.MM.dd") : d;
      
      if (start) {
        eduInfo.date = formatDate(start) + (end ? " ~ " + formatDate(end) : "");
      }
      if (loc) eduInfo.location = loc;
    }
  }

  let subject = `[SBS A&T] 교육 신청 ${status} 안내 - ${course}`;
  let body = "";

  const headerStyle = "style='color: #4f46e5; font-size: 1.2rem; font-weight: bold; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; margin-bottom: 20px;'";
  const boxStyle = "style='background-color: #f9fafb; border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px; line-height: 1.6;'";

  switch (status) {
    case '대기':
      subject = `[SBS A&T] 교육 신청이 정상적으로 접수되었습니다 - ${course}`;
      body = `
        <div ${headerStyle}>안녕하세요, ${name}님.</div>
        <p>SBS A&T Hightech Platform 교육 신청이 정상적으로 접수되었습니다.</p>
        <div ${boxStyle}>
          <strong>신청 과정:</strong> ${course}<br>
          <strong>교육 일정:</strong> ${eduInfo.date}<br>
          <strong>교육 장소:</strong> ${eduInfo.location}<br>
          <strong>현재 상태:</strong> 신청 대기 (담당자 확인 중)
        </div>
        <p>담당자가 기재해주신 정보를 바탕으로 확인 후, 이메일을 통해 최종 승인 여부를 안내해 드릴 예정입니다.</p>
      `;
      break;
    case '승인':
      subject = `[SBS A&T] 교육 신청이 승인되었습니다 - ${course}`;
      body = `
        <div ${headerStyle}>안녕하세요, ${name}님.</div>
        <p>신청하신 과정이 최종 <strong>승인</strong>되었습니다.</p>
        <div ${boxStyle}>
          <strong>과정명:</strong> ${course}<br>
          <strong>교육 일정:</strong> ${eduInfo.date}<br>
          <strong>교육 시간:</strong> 10:00 - 18:00<br>
          <strong>교육 장소:</strong> ${eduInfo.location}<br>
          <strong>상태:</strong> 승인 완료
        </div>
        <p>자세한 교육 참석 안내 사항은 추후 별도의 안내 메일을 드릴 예정입니다.<br> 신청하신 교육 참석이 어려울 시 haba98@sbs.co.kr로 즉시 알려주시길 바랍니다.</p>
      `;
      break;
    case '반려':
      subject = `[SBS A&T] 교육 신청 반려 안내 - ${course}`;
      body = `
        <div ${headerStyle}>안녕하세요, ${name}님.</div>
        <p>아쉽게도 해당 교육 과정의 신청이 <strong>반려</strong>되었습니다.</p>
        <div ${boxStyle}>
          <strong>과정명:</strong> ${course}<br>
          <strong>반려 사유:</strong> ${reason || '정원 초과 또는 요건 미충족'}
          <strong>문의:</strong> haba98@sbs.co.kr
        </div>
        <p>관련하여 문의사항이 있으시면 haba98@sbs.co.kr로 연락 주시기 바랍니다.</p>
      `;
      break;
    case '취소':
      subject = `[SBS A&T] 교육 신청이 취소되었습니다 - ${course}`;
      body = `
        <div ${headerStyle}>안녕하세요, ${name}님.</div>
        <p>신청하신 교육 과정이 정상적으로 <strong>취소</strong> 처리되었습니다.</p>
        <div ${boxStyle}>
          <strong>과정명:</strong> ${course}<br>
          <strong>취소 사유:</strong> ${reason || '사용자 요청'}
        </div>
        <p>다음에 더 좋은 기회로 만나 뵙기를 바랍니다.</p>
      `;
      break;
    case '승인 대기':
      subject = `[SBS A&T] 교육 신청 승인 대기 안내 - ${course}`;
      body = `
        <div ${headerStyle}>안녕하세요, ${name}님.</div>
        <p>교육 신청이 <strong>승인 대기</strong> 상태로 전환되었습니다.</p>
        <div ${boxStyle}>
          <strong>과정명:</strong> ${course}<br>
          <strong>승인 대기:</strong> 정원 외 신청으로 취소 또는 결원 발생 시 순차적으로 승인 전환<br>
          ${waitingNum ? `<strong>대기 순번:</strong> ${waitingNum}번<br>` : ''}
          <strong>문의:</strong> haba98@sbs.co.kr
        </div>
        <p>본 과정은 선착순 정원 외 신청으로, 기존 승인 인원 중 <strong>결원 발생 시</strong> 순차적으로 최종 승인 처리될 예정입니다.</p>
        <p>최종 승인 여부는 추후 다시 안내해 드리겠습니다. 기다려 주셔서 감사합니다.</p>
      `;
      break;
  }

  const footer = `
    <div style="margin-top: 30px; font-size: 0.85rem; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 10px;">
      본 메일은 발신 전용입니다. 문의는 haba98@sbs.co.kr로 연락 주시기 바랍니다.<br>
      © SBS A&T Hightech Platform. All rights reserved.
    </div>
  `;

  try {
    GmailApp.sendEmail(email, subject, "", {
      name: "SBS A&T 교육팀",
      htmlBody: body + footer
    });
  } catch (e) {
    console.error("Email sending failed:", e.toString());
  }
}

/**
 * [추가] 관리자가 시트에서 직접 '처리상태'를 변경할 때 이메일 발송
 * (반드시 '수정 시' 실행되는 설치 가능한 트리거 설정을 해야 함)
 */
function onEditTrigger(e) {
  const range = e.range;
  const sheet = range.getSheet();
  const sheetName = sheet.getName();
  
  // 'Applications' 시트이고, 7번째 열(처리상태)이 수정된 경우만 작동
  if (sheetName === 'Applications' && range.getColumn() === 7 && range.getRow() > 1) {
    const rowIndex = range.getRow();
    const fullData = sheet.getDataRange().getValues();
    const headers = fullData[0];
    const rowData = fullData[rowIndex - 1];
    
    // 헤더 이름을 기준으로 인덱스 찾기 (유연한 대응)
    const idxStatus = headers.indexOf("처리상태");
    const idxName = headers.indexOf("이름");
    const idxCourse = headers.indexOf("신청과정");
    const idxEmail = headers.indexOf("이메일");
    const idxNote = headers.indexOf("비고"); 
    const idxCancelReason = headers.indexOf("취소사유");
    const idxWaitingNum = headers.indexOf("대기번호");
    const idxStatusModified = headers.indexOf("처리변환일시");

    const status = rowData[idxStatus]; 
    const name = rowData[idxName];   
    const course = rowData[idxCourse]; 
    const email = rowData[idxEmail];  
    const note = idxNote !== -1 ? rowData[idxNote] : "";
    const cancelReason = idxCancelReason !== -1 ? rowData[idxCancelReason] : "";
    const waitingNum = idxWaitingNum !== -1 ? rowData[idxWaitingNum] : "";

    // 상태가 변경되었고, 새로운 상태 값이 비어있지 않은 경우에만 처리
    if (status && e.oldValue !== status) {
      // 1. 처리변환일시 기록
      if (idxStatusModified !== -1) {
        sheet.getRange(rowIndex, idxStatusModified + 1).setValue(new Date());
      }

      // 2. 이메일 발송
      const reasonToSend = (status === '취소' || status === '반려') ? cancelReason : note;
      sendApplicationEmail({
        name: name,
        email: email,
        course: course,
        status: status,
        reason: reasonToSend,
        waitingNum: waitingNum 
      });
    }
  }
}
