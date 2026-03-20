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
  try {
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

      // 이름, 이메일, 신청과정으로 행 찾기
      for (let i = 1; i < allData.length; i++) {
        if (allData[i][1].toString().trim() === searchName && 
            allData[i][7].toString().trim() === searchEmail && 
            allData[i][3].toString().trim() === searchCourse) {
          foundRowIndex = i + 1; // 1-based index
          break;
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

    let duplicatedRound = "";
    const isDuplicate = existingData.some(row => {
      const rowName = row[1].toString().trim();
      const rowEmail = row[7].toString().trim();
      const rowFullCourse = row[3].toString().trim(); // 예: "AI영상제작 기초 (1회차)"
      const rowCourseBase = rowFullCourse.split(' (')[0].trim();

      if (rowName === applyName && rowEmail === applyEmail && rowCourseBase === applyCourseBase) {
        // 이미 신청한 회차 정보를 추출 (메시지용)
        const match = rowFullCourse.match(/\((.*?)회차\)/);
        duplicatedRound = match ? match[1] : "";
        return true;
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

    // 새 헤더 순서대로 데이터 배열 생성
    // [신청일시(1), 이름(2), 연락처(3), 신청과정(4), Start Date(5), End Date(6), 처리상태(7), 이메일(8), 회사명(9), 부서/직급(10), 재직여부(11), 주민등록번호(12), 비고(13), 취소사유(14)]
    const newRow = [
      new Date(), // 신청일시
      data.name,
      "'" + data.phone, // 연락처
      data.course,
      data.startDate || '',
      data.endDate || '',
      '대기', // 처리상태
      data.email,
      data.company || '',
      data.position,
      data.employment,
      '', // 주민등록번호 (필요 시 수집 가능)
      '', // 비고
      ''  // 취소사유
    ];

    sheet.appendRow(newRow);
    
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
  }
}

/**
 * [추가] 이메일 발송 통합 함수
 */
function sendApplicationEmail(info) {
  const { name, email, course, status, reason } = info;
  
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
    const rowData = sheet.getRange(rowIndex, 1, 1, 14).getValues()[0];
    
    const status = rowData[6]; // 처리상태 (Index 6)
    const name = rowData[1];   // 이름 (Index 1)
    const course = rowData[3]; // 신청과정 (Index 3)
    const email = rowData[7];  // 이메일 (Index 7)
    const reason = rowData[13]; // 취소사유/비고 (Index 13)

    // 상태가 변경되었고, 새로운 상태 값이 비어있지 않은 경우에만 발송
    if (status && e.oldValue !== status) {
      sendApplicationEmail({
        name: name,
        email: email,
        course: course,
        status: status,
        reason: reason
      });
    }
  }
}
