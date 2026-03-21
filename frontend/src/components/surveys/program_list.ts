/** Shown when no primary major is selected. */
export const SCHOOL_NA = "N/A";

export const KRIEGER_SCHOOL_LABEL = "Krieger School of Arts & Sciences";
export const WHITING_SCHOOL_LABEL = "Whiting School of Engineering";

export interface ProgramListEntry {
  name: string;
  hasMajor: boolean;
  hasMinor: boolean;
  /** If true, this program’s major is under Whiting; otherwise Krieger (for majors). */
  isWhiting?: boolean;
}

export const PROGRAM_LIST: ProgramListEntry[] = [
    {name: "Accounting & Financial Management", hasMajor: false, hasMinor: true},
    {name: "Africana Studies", hasMajor: true, hasMinor: true},
    {name: "Anthropology", hasMajor: true, hasMinor: true},
    {name: "Applied Mathematics and Statistics", hasMajor: true, hasMinor: true, isWhiting: true},
    {name: "Archaeology", hasMajor: true, hasMinor: true},
    {name: "Behavioral Biology", hasMajor: true, hasMinor: false},
    {name: "Bioethics", hasMajor: false, hasMinor: true},
    {name: "Biology", hasMajor: true, hasMinor: false},
    {name: "Biomedical Engineering", hasMajor: true, hasMinor: false, isWhiting: true},
    {name: "Biophysics", hasMajor: true, hasMinor: false},
    {name: "Business", hasMajor: false, hasMinor: true},
    {name: "Chemical and Biomolecular Engineering", hasMajor: true, hasMinor: false, isWhiting: true},
    {name: "Chemistry", hasMajor: true, hasMinor: false},
    {name: "Civic Life", hasMajor: false, hasMinor: true},
    {name: "Civil Engineering", hasMajor: true, hasMinor: true, isWhiting: true},
    {name: "Classics", hasMajor: true, hasMinor: true},
    {name: "Cognitive Science", hasMajor: true, hasMinor: false},
    {name: "Comparative Thought and Literature", hasMajor: false, hasMinor: true},
    {name: "Computational Medicine", hasMajor: false, hasMinor: true},
    {name: "Computer Engineering", hasMajor: true, hasMinor: false, isWhiting: true},
    {name: "Computer Integrated Surgery", hasMajor: false, hasMinor: true},
    {name: "Computer Science", hasMajor: true, hasMinor: true, isWhiting: true},
    {name: "Critical Diaspora Studies", hasMajor: true, hasMinor: false},
    {name: "Earth and Planetary Sciences", hasMajor: true, hasMinor: true},
    {name: "East Asian Studies", hasMajor: true, hasMinor: true},
    {name: "Economics", hasMajor: true, hasMinor: true},
    {name: "Electrical Engineering", hasMajor: true, hasMinor: false, isWhiting: true},
    {name: "Energy", hasMajor: false, hasMinor: true},
    {name: "Engineering for Sustainable Development", hasMajor: false, hasMinor: true},
    {name: "Engineering Mechanics", hasMajor: true, hasMinor: false, isWhiting: true},
    {name: "English", hasMajor: true, hasMinor: true},
    {name: "Entrepreneurship and Management", hasMajor: false, hasMinor: true},
    {name: "Environmental Engineering", hasMajor: true, hasMinor: true, isWhiting: true},
    {name: "Environmental Science", hasMajor: true, hasMinor: true},
    {name: "Environmental Studies", hasMajor: true, hasMinor: true},
    {name: "Film and Media Studies", hasMajor: true, hasMinor: true},
    {name: "Financial Economics", hasMajor: false, hasMinor: true},
    {name: "French", hasMajor: true, hasMinor: true},
    {name: "General Engineering", hasMajor: true, hasMinor: false, isWhiting: true},
    {name: "German", hasMajor: true, hasMinor: true},
    {name: "History", hasMajor: true, hasMinor: true},
    {name: "History of Art", hasMajor: true, hasMinor: true},
    {name: "History of Science, Medicine, and Technology", hasMajor: true, hasMinor: true},
    {name: "Interdisciplinary Studies", hasMajor: true, hasMinor: false},
    {name: "International Studies", hasMajor: true, hasMinor: false},
    {name: "Islamic Studies", hasMajor: false, hasMinor: false},
    {name: "Italian", hasMajor: true, hasMinor: true},
    {name: "Jewish Studies", hasMajor: false, hasMinor: true},
    {name: "Latin American, Caribbean, and Latinx Studies", hasMajor: true, hasMinor: true},
    {name: "Leadership Studies", hasMajor: false, hasMinor: true},
    {name: "Linguistics", hasMajor: false, hasMinor: true},
    {name: "Marketing & Communications", hasMajor: false, hasMinor: true},
    {name: "Materials Science and Engineering", hasMajor: true, hasMinor: false, isWhiting: true},
    {name: "Mathematics", hasMajor: true, hasMinor: true},
    {name: "Mechanical Engineering", hasMajor: true, hasMinor: false, isWhiting: true},
    {name: "Medicine, Science, and the Humanities", hasMajor: true, hasMinor: false},
    {name: "Molecular and Cellular Biology", hasMajor: true, hasMinor: false},
    {name: "Moral and Political Economy", hasMajor: true, hasMinor: false},
    {name: "Museums and Society", hasMajor: false, hasMinor: true},
    {name: "Music", hasMajor: false, hasMinor: true},
    {name: "Natural Sciences", hasMajor: true, hasMinor: false},
    {name: "Near Eastern Studies", hasMajor: true, hasMinor: true},
    {name: "Neuroscience", hasMajor: true, hasMinor: false},
    {name: "Philosophy", hasMajor: true, hasMinor: true},
    {name: "Physics", hasMajor: true, hasMinor: true},
    {name: "Political Science", hasMajor: true, hasMinor: false},
    {name: "Portuguese", hasMajor: false, hasMinor: true},
    {name: "Psychology", hasMajor: true, hasMinor: true},
    {name: "Public Health Studies", hasMajor: true, hasMinor: false},
    {name: "Robotics", hasMajor: false, hasMinor: true},
    {name: "Romance Languages", hasMajor: true, hasMinor: false},
    {name: "Social Policy", hasMajor: false, hasMinor: false},
    {name: "Sociology", hasMajor: true, hasMinor: false},
    {name: "Space Science and Engineering", hasMajor: false, hasMinor: true},
    {name: "Spanish", hasMajor: true, hasMinor: false},
    {name: "Spanish for the Professions", hasMajor: false, hasMinor: true},
    {name: "Spanish Language and Hispanic Culture", hasMajor: false, hasMinor: true},
    {name: "Systems Engineering", hasMajor: true, hasMinor: true, isWhiting: true},
    {name: "Theatre Arts and Studies", hasMajor: false, hasMinor: true},
    {name: "Visual Arts", hasMajor: false, hasMinor: true},
    {name: "Women, Gender, and Sexuality", hasMajor: false, hasMinor: true},
    {name: "Writing Seminars", hasMajor: true, hasMinor: true}
];

/** School derived from the user’s primary (first) major; not user-editable. */
export function getSchoolLabelForPrimaryMajor(programName: string | null | undefined): string {
  if (!programName?.trim()) return SCHOOL_NA;
  const entry = PROGRAM_LIST.find((p) => p.name === programName);
  if (!entry) return SCHOOL_NA;
  return entry.isWhiting === true ? WHITING_SCHOOL_LABEL : KRIEGER_SCHOOL_LABEL;
}