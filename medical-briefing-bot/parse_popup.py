import xml.etree.ElementTree as ET

tree = ET.parse('hira_aq_popup.xml')
root = tree.getroot()

for ds in root.findall('.//{http://www.nexacroplatform.com/platform/dataset}Dataset'):
    ds_id = ds.attrib.get('id')
    print(f"Dataset: {ds_id}")
    rows = ds.findall('.//{http://www.nexacroplatform.com/platform/dataset}Row')
    if ds_id == 'dsBoardList':
        for row in rows:
            cols = {col.attrib.get('id'): col.text for col in row.findall('.//{http://www.nexacroplatform.com/platform/dataset}Col')}
            print(f"[{cols.get('fstRegDt')}] {cols.get('bltnTtl')} - ID: {cols.get('brdSno')}")
    else:
        # Check if '폐렴' is in this dataset
        for row in rows:
            text_content = "".join(row.itertext())
            if '폐렴' in text_content:
                print(f"Found in {ds_id}!")
                cols = {col.attrib.get('id'): col.text for col in row.findall('.//{http://www.nexacroplatform.com/platform/dataset}Col')}
                print(cols)
                break
