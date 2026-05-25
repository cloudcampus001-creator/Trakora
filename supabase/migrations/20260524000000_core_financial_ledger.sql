-- 1. EXTENSIONS & ENUMS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE app_role AS ENUM ('super_admin', 'principal', 'bursar');
CREATE TYPE fee_mode AS ENUM ('UNIFORM', 'SEGMENTED');
CREATE TYPE tx_status AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
CREATE TYPE tx_type AS ENUM ('REGISTRATION', 'TUITION');

-- 2. CORE TABLES
CREATE TABLE schools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
    role app_role NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE school_configs (
    school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
    fee_structure fee_mode DEFAULT 'UNIFORM',
    uniform_registration_fee DECIMAL(12, 2) DEFAULT 0.00,
    uniform_tuition_fee DECIMAL(12, 2) DEFAULT 0.00,
    momo_number VARCHAR(30),
    momo_carrier VARCHAR(50), -- 'MTN' or 'ORANGE'
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    segmented_registration_fee DECIMAL(12, 2) DEFAULT 0.00,
    segmented_tuition_fee DECIMAL(12, 2) DEFAULT 0.00,
    CONSTRAINT unique_school_class UNIQUE(school_id, name)
);

CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
    class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
    matricule VARCHAR(100) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    parent_phone VARCHAR(30) NOT NULL,
    is_registered BOOLEAN DEFAULT FALSE,
    tuition_paid DECIMAL(12, 2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE financial_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    amount DECIMAL(12, 2) NOT NULL,
    type tx_type NOT NULL,
    status tx_status DEFAULT 'PENDING',
    operator_reference VARCHAR(255) UNIQUE,
    bursar_printed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;

-- Super Admin Global Access Check
CREATE OR REPLACE FUNCTION is_super_admin() 
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM profiles 
        WHERE id = auth.uid() AND role = 'super_admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- General Multitenant Read/Write Policies
CREATE POLICY school_isolation_policy ON profiles 
    FOR ALL USING (is_super_admin() OR school_id = (SELECT school_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY school_data_policy ON schools 
    FOR ALL USING (is_super_admin() OR id = (SELECT school_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY config_policy ON school_configs 
    FOR ALL USING (is_super_admin() OR school_id = (SELECT school_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY class_policy ON classes 
    FOR ALL USING (is_super_admin() OR school_id = (SELECT school_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY student_policy ON students 
    FOR ALL USING (is_super_admin() OR school_id = (SELECT school_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY transaction_policy ON financial_transactions 
    FOR ALL USING (is_super_admin() OR school_id = (SELECT school_id FROM profiles WHERE id = auth.uid()));

-- Public visibility for Parent Portal registrations via School QR Code link
CREATE POLICY parent_portal_view_schools ON schools FOR SELECT USING (true);
CREATE POLICY parent_portal_view_configs ON school_configs FOR SELECT USING (true);
CREATE POLICY parent_portal_view_classes ON classes FOR SELECT USING (true);
CREATE POLICY parent_portal_student_lookup ON students FOR SELECT USING (true);
CREATE POLICY parent_portal_insert_student ON students FOR INSERT WITH CHECK (true);
CREATE POLICY parent_portal_insert_tx ON financial_transactions FOR INSERT WITH CHECK (true);
CREATE POLICY parent_portal_view_tx ON financial_transactions FOR SELECT USING (true);

-- 4. REALTIME REPLICATION CONFIGURATION
-- Ensure the financial transactions table broadcasts immediately upon new successful records
ALTER PUBLICATION supabase_realtime ADD TABLE financial_transactions;