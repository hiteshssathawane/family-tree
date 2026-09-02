/* ============================================================
   FAMILY TREE DATA (AUTO-GENERATED)
   ----------------------------------------------------------------
   Generated on: 2026-09-02
   ============================================================ */

window.FAMILY_DATA = {
  "meta": {
    "familyName": "Sathawane's Family Tree",
    "description": "A genealogy record of the Sathawane family.",
    "version": "1.0.0",
    "createdAt": "2026-09-02",
    "updatedAt": "2026-09-02",
    "rootPersonId": "HITESH_JYOTI_SHANKAR_SATHAWANE",
    "privacy": {
      "hideLivingContactInfo": true,
      "hideLivingDOBYear": false,
      "publicViewAllowed": false
    }
  },
  "persons": [
    {
      "id": "HITESH_JYOTI_SHANKAR_SATHAWANE",
      "firstName": "Hitesh",
      "fatherName": "",
      "motherName": "",
      "lastName": "Sathawane",
      "maidenName": null,
      "gender": "M",
      "status": "living",
      "maritalStatus": "single",
      "birthDate": "1985-12-29",
      "birthPlace": null,
      "deathDate": null,
      "deathPlace": null,
      "occupation": null,
      "education": null,
      "location": null,
      "commonName": null,
      "commonNameMr": null,
      "firstNameMr": "हितेश",
      "lastNameMr": "साठवणे",
      "biography": "Initial admin member.",
      "profilePhoto": null,
      "backgroundPhoto": null,
      "tags": [],
      "private": false
    }
  ],
  "relationships": [],
  "events": [],
  "media": [],
  "scrapbook": {}
};
window.I18N_DATA = { en: {
  "app": {
    "name": "The Family Tree",
    "tagline": "Our Heritage"
  },
  "login": {
    "title": "The Family Tree",
    "subtitle": "Our Heritage",
    "step1": {
      "heading": "Family password",
      "placeholder": "e.g. Shankar15071952Vijay",
      "hint": "No spaces. Suggested format: FirstnameOfElderDOBFriendName. Example: Shankar15071952Vijay (Elder's name + their DOB + a friend only family knows)",
      "button": "Enter the family home"
    },
    "step2": {
      "heading": "Who are you?",
      "subtitle": "Enter your details to identify yourself",
      "namePlaceholder": "Your full name (e.g. Vikram Sharma)",
      "dobPlaceholder": "Date of birth — DDMMYYYY (e.g. 04111972)",
      "hint": "Like your PAN card password — your name + birthday",
      "button": "Confirm identity"
    },
    "step3": {
      "heading": "One-time code",
      "subtitle": "Open Google Authenticator → Family Tree",
      "hint": "Code changes every 30 seconds · No internet needed",
      "adminOnly": "Only required for Admin and Contributors",
      "button": "Verify and enter"
    }
  },
  "nav": {
    "tree": "Tree",
    "calendar": "Calendar",
    "map": "Map",
    "admin": "Admin",
    "search": "Search family members…"
  },
  "tree": {
    "viewModes": {
      "full": "Full tree",
      "ancestorFour": "4 generations up",
      "descendantFour": "4 generations down",
      "hourglass": "Hourglass (both)",
      "compact": "Compact (2 gen)"
    },
    "allMembers": "All members",
    "controls": {
      "zoomIn": "Zoom in",
      "zoomOut": "Zoom out",
      "fit": "Fit to screen",
      "print": "Print tree"
    }
  },
  "profile": {
    "tabs": {
      "timeline": "Timeline",
      "bio": "Bio",
      "family": "Family"
    },
    "fields": {
      "born": "Born",
      "birthplace": "Birthplace",
      "died": "Passed away",
      "deathPlace": "Place of passing",
      "livesIn": "Lives in",
      "occupation": "Occupation",
      "education": "Education",
      "religion": "Religion",
      "maritalStatus": "Marital status",
      "maidenName": "Maiden name",
      "knownAs": "Known as"
    },
    "relationships": {
      "spouse": "Spouse / Partner",
      "parents": "Parents",
      "children": "Children",
      "siblings": "Siblings"
    },
    "lifeStory": "Life story",
    "emptyState": "We haven't recorded anything about {name} yet.",
    "noEvents": "No events recorded yet."
  },
  "calendar": {
    "title": "Family calendar",
    "subtitle": "Upcoming occasions · Next 365 days",
    "filters": {
      "allBranches": "All branches",
      "birthdays": "Birthdays",
      "anniversaries": "Anniversaries",
      "deathAnniversaries": "Death anniversaries",
      "reunions": "Reunions",
      "remembrance": "Remembrance"
    },
    "daysAway": "days away",
    "today": "Today!",
    "shareWhatsApp": "Share via WhatsApp",
    "downloadIcs": "Download .ics",
    "eventTypes": {
      "birth": "Birthday",
      "marriage": "Anniversary",
      "death": "Death anniversary",
      "reunion": "Reunion"
    }
  },
  "admin": {
    "title": "Admin panel",
    "stats": {
      "members": "Members",
      "events": "Events",
      "photos": "Photos",
      "pendingPRs": "Pending PRs"
    },
    "addMember": {
      "title": "Add member",
      "subtitle": "Mandatory fields only — fill the rest later",
      "firstName": "First name *",
      "lastName": "Last name *",
      "dob": "Date of birth (DDMMYYYY) *",
      "roles": {
        "viewer": "Viewer",
        "contributor": "Contributor",
        "admin": "Admin"
      },
      "branch": "Branch",
      "photoUpload": "Drop profile photo here or tap to select",
      "photoHint": "Uploaded to Cloudflare R2 · max 5MB",
      "submit": "Add to tree → GitHub PR"
    },
    "bulkImport": {
      "title": "Bulk import (CSV)",
      "subtitle": "Import multiple family members at once",
      "downloadTemplate": "Download CSV template",
      "uploadCSV": "Upload filled CSV",
      "pasteCSV": "Or paste CSV data here",
      "preview": "Preview",
      "confirm": "Import to family tree",
      "instructions": "Fill in the template in Excel or Google Sheets. Mandatory columns: id, firstName, lastName, gender, status. All others optional."
    },
    "totp": {
      "title": "TOTP setup",
      "subtitle": "Generate a QR code for a family member to scan once",
      "namePlaceholder": "Member name",
      "dobPlaceholder": "Date of birth",
      "generate": "Generate QR code",
      "instructions": "Send QR screenshot via WhatsApp. Member scans once in Google Authenticator."
    },
    "importExport": {
      "title": "Import / export",
      "importCsv": "Import CSV",
      "downloadJson": "Download family.json",
      "exportGedcom": "Export GEDCOM (.ged)"
    }
  },
  "security": {
    "printBlocked": "This content cannot be printed.",
    "screenshotWarning": "Screenshot detected — this action has been logged.",
    "watermarkText": "· Family Tree"
  },
  "errors": {
    "wrongPassword": "Incorrect family password. Please try again.",
    "identityNotFound": "Name and date of birth not found. Check spelling.",
    "wrongTotp": "Incorrect code. Please check Google Authenticator and try again.",
    "dataLoadFailed": "Could not load family data. Please refresh."
  },
  "loading": {
    "message": "Loading family data..."
  },
  "export": {
    "processing": "Processing...",
    "complete": "Export complete!",
    "failed": "Export failed. Please try again."
  }
}, mr: {
  "app": {
    "name": "आपले कुटुंब",
    "tagline": "आपली परंपरा"
  },
  "login": {
    "title": "आपले कुटुंब",
    "subtitle": "आपली परंपरा",
    "step1": {
      "heading": "कुटुंबाचा पासवर्ड",
      "placeholder": "उदा. Shankar15071952Vijay",
      "hint": "कोणतेही स्पेस नकोत. सूचित स्वरूप: वडिलांचे नाव + त्यांची जन्मतारीख + कुटुंबाच्या मैत्रीचे नाव. उदाहरण: Shankar15071952Vijay",
      "button": "कुटुंबात प्रवेश करा"
    },
    "step2": {
      "heading": "तुम्ही कोण आहात?",
      "subtitle": "ओळख पटवण्यासाठी माहिती द्या",
      "namePlaceholder": "पूर्ण नाव (उदा. विक्रम शर्मा)",
      "dobPlaceholder": "जन्मतारीख — DDMMYYYY (उदा. 04111972)",
      "hint": "PAN कार्डसारखे — तुमचे नाव + जन्मतारीख",
      "button": "ओळख निश्चित करा"
    },
    "step3": {
      "heading": "एक-वेळचा कोड",
      "subtitle": "Google Authenticator उघडा → Family Tree",
      "hint": "दर ३० सेकंदात बदलतो · इंटरनेट लागत नाही",
      "adminOnly": "केवळ Admin आणि Contributor साठी आवश्यक",
      "button": "प्रवेश करा"
    }
  },
  "nav": {
    "tree": "वंशवृक्ष",
    "calendar": "दिनदर्शिका",
    "map": "नकाशा",
    "admin": "व्यवस्थापन",
    "search": "कुटुंब सदस्य शोधा…"
  },
  "tree": {
    "viewModes": {
      "full": "संपूर्ण वंशवृक्ष",
      "ancestorFour": "४ पिढ्या वरती",
      "descendantFour": "४ पिढ्या खाली",
      "hourglass": "दोन्ही बाजूंनी",
      "compact": "संक्षिप्त (२ पिढ्या)"
    },
    "allMembers": "सर्व सदस्य",
    "controls": {
      "zoomIn": "मोठे करा",
      "zoomOut": "लहान करा",
      "fit": "स्क्रीनवर बसवा",
      "print": "छापा"
    }
  },
  "profile": {
    "tabs": {
      "timeline": "टाइमलाइन",
      "bio": "माहिती",
      "family": "कुटुंब"
    },
    "fields": {
      "born": "जन्म",
      "birthplace": "जन्मस्थान",
      "died": "निधन",
      "deathPlace": "निधनस्थान",
      "livesIn": "राहतात",
      "occupation": "व्यवसाय",
      "education": "शिक्षण",
      "religion": "धर्म",
      "maritalStatus": "वैवाहिक स्थिती",
      "maidenName": "माहेरचे आडनाव",
      "knownAs": "म्हणून ओळखले जातात"
    },
    "relationships": {
      "spouse": "जोडीदार",
      "parents": "आई-वडील",
      "children": "मुले",
      "siblings": "भाऊ-बहीण"
    },
    "lifeStory": "जीवनकथा",
    "emptyState": "{name} बद्दल अद्याप काही नोंदवलेले नाही.",
    "noEvents": "अद्याप कोणतेही प्रसंग नोंदवले नाहीत."
  },
  "calendar": {
    "title": "कुटुंब दिनदर्शिका",
    "subtitle": "येणारे प्रसंग · पुढील ३६५ दिवस",
    "filters": {
      "allBranches": "सर्व शाखा",
      "birthdays": "वाढदिवस",
      "anniversaries": "लग्नवर्धापनदिन",
      "deathAnniversaries": "पुण्यतिथी",
      "reunions": "कुटुंब मेळावा",
      "remembrance": "पुण्यतिथी"
    },
    "daysAway": "दिवस बाकी",
    "today": "आजच!",
    "shareWhatsApp": "WhatsApp वर शेअर करा",
    "downloadIcs": ".ics डाउनलोड करा",
    "eventTypes": {
      "birth": "वाढदिवस",
      "marriage": "लग्नवर्धापनदिन",
      "death": "पुण्यतिथी",
      "reunion": "कुटुंब मेळावा"
    }
  },
  "admin": {
    "title": "व्यवस्थापन",
    "stats": {
      "members": "सदस्य",
      "events": "घटना",
      "photos": "फोटो",
      "pendingPRs": "प्रलंबित PRs"
    },
    "addMember": {
      "title": "सदस्य जोडा",
      "subtitle": "केवळ आवश्यक माहिती — बाकी नंतर भरता येईल",
      "firstName": "पहिले नाव *",
      "lastName": "आडनाव *",
      "dob": "जन्मतारीख (DDMMYYYY) *",
      "submit": "वंशवृक्षात जोडा → GitHub PR",
      "roles": {
        "viewer": "दर्शक",
        "contributor": "योगदानकर्ता",
        "admin": "व्यवस्थापक"
      },
      "branch": "शाखा",
      "photoUpload": "प्रोफाइल फोटो येथे टाका किंवा निवडण्यासाठी टॅप करा",
      "photoHint": "Cloudflare R2 वर अपलोड · कमाल 5MB"
    },
    "bulkImport": {
      "title": "एकत्र आयात (CSV)",
      "subtitle": "एकाच वेळी अनेक सदस्य आयात करा",
      "downloadTemplate": "CSV नमुना डाउनलोड करा",
      "uploadCSV": "भरलेला CSV अपलोड करा",
      "confirm": "वंशवृक्षात आयात करा",
      "pasteCSV": "किंवा CSV डेटा येथे पेस्ट करा",
      "preview": "पूर्वावलोकन",
      "instructions": "Excel किंवा Google Sheets मध्ये नमुना भरा. आवश्यक रकाने: id, firstName, lastName, gender, status. बाकी सर्व ऐच्छिक."
    },
    "totp": {
      "title": "TOTP सेटअप",
      "subtitle": "कुटुंबातील सदस्याला एकदा स्कॅन करण्यासाठी QR code तयार करा",
      "namePlaceholder": "सदस्याचे नाव",
      "dobPlaceholder": "जन्म तारीख",
      "generate": "QR code तयार करा",
      "instructions": "WhatsApp द्वारे QR स्क्रीनशॉट पाठवा. सदस्य Google Authenticator मध्ये एकदा स्कॅन करतील."
    },
    "importExport": {
      "title": "आयात / निर्यात",
      "importCsv": "CSV आयात करा",
      "downloadJson": "family.json डाउनलोड करा",
      "exportGedcom": "GEDCOM (.ged) निर्यात करा"
    }
  },
  "security": {
    "printBlocked": "हे पान छापता येत नाही.",
    "screenshotWarning": "स्क्रीनशॉट नोंदवला गेला.",
    "watermarkText": "· कुटुंब वृक्ष"
  },
  "errors": {
    "wrongPassword": "चुकीचा पासवर्ड. पुन्हा प्रयत्न करा.",
    "identityNotFound": "नाव आणि जन्मतारीख सापडली नाही. स्पेलिंग तपासा किंवा पाहुणा म्हणून पुढे जा.",
    "wrongTotp": "चुकीचा कोड. Google Authenticator तपासा आणि पुन्हा प्रयत्न करा.",
    "dataLoadFailed": "कुटुंब डेटा लोड करणे शक्य झाले नाही. कृपया रीफ्रेश करा."
  },
  "loading": {
    "message": "कुटुंब डेटा लोड करत आहे..."
  },
  "export": {
    "processing": "प्रक्रिया करत आहे...",
    "complete": "निर्यात पूर्ण!",
    "failed": "निर्यात अयशस्वी. कृपया पुन्हा प्रयत्न करा."
  }
} };
