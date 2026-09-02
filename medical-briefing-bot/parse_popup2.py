import xml.etree.ElementTree as ET

tree = ET.parse('hira_aq_popup.xml')
root = tree.getroot()

for ds in root.findall('.//{http://www.nexacroplatform.com/platform/dataset}Dataset'):
    if ds.attrib.get('id') == 'dsList':
        for row in ds.findall('.//{http://www.nexacroplatform.com/platform/dataset}Row')[:15]:
            cols = {col.attrib.get('id'): col.text for col in row.findall('.//{http://www.nexacroplatform.com/platform/dataset}Col')}
            print(f"[{cols.get('regDt')}] {cols.get('brdTtl')}")
